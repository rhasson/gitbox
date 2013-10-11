var platform = require('git-node-platform')
  , jsGit = require('js-git')(platform)
  , fsDb = require('git-fs-db')(platform)
  , fs = platform.fs
  , nfs = require('graceful-fs')
  , watchr = require('watchr')
  , path = require('path')
  , trie = require('path-trie')
  , async = require('async')
  , config = require('./config').config
  , timer = 5000
  , interval = null;

var util = require('util');

// Create a filesystem backed bare repo
var repo = jsGit(fsDb(fs("home.git")))
  , home = config.home.path //process.argv.splice(2)[0]
  , index
  , __parent = null
  , commiter = config.commiter
  , message = 'Commit message';

if (!home) throw 'Must provide a full path to home directory';

watchr.watch({
	path: home,
	listeners: {
		watching: function(err, instance, isWatch) {
			if (err) throw err;
			console.log('Watching: ', instance.path);
			repo.loadAs('commit', 'HEAD', function(err, commit, hash) {
				if (!err && commit && hash) {
					repo.updateHead(hash, moveHead);
					__parent = hash;
				} else {
					repo.setHead("master", function (err) {
						if (err) throw err;
						console.log('set HEAD to master');
						__parent = null;
					});
				} 
			});
		},
 		log: function(logLevel){
            var args = Array.prototype.slice.call(arguments);
            //console.log(args);
        },
		change: function(changeType, filePath, currentStat, previousStat) {
			switch (changeType) {
				case 'create':
					handleCreate(filePath, currentStat, previousStat);
					break;
				case 'update':
					handleUpdate(filePath, currentStat, previousStat);
					break;
				case 'delete':
					handleDelete(filePath, currentStat, previousStat);
					break;
				default:
					console.log('Unknown type: ', changeType, filePath);
			}
		},
		error: function(e) {
			console.log('Err: ', e);
		}
	},
	persistent: true,
	ignoreHiddenFiles: true,
	ignoreCustomPatterns: /\.(tmp)$/i
});

function handleCreate(filePath, currentStat, previousStat) {
	console.log('handleCreate: ', filePath);
	
	stage(filePath, currentStat, previousStat);
}

function handleUpdate(filePath, currentStat, previousStat) {
	console.log('handleUpdate: ', filePath);

	stage(filePath, currentStat, previousStat);
}

function handleDelete(filePath, currentStat, previousStat) {
	console.log('handleDelete: ', filePath);
}

function stage(filePath, currentStat, previousStat) {
	var name = path.basename(filePath)
	  , base = path.basename(home)
	  , ex_home = new RegExp('(' + base + ').*')
	  , startPath = name
	  , i = filePath.match(ex_home).index; // index of where home directory starts

	// create the index is it doesn't exist
	if (!trie.get(base)) index = trie.put(base, {
			master: true,
			active: false,
			mode: 040000,
			name: base,
			nodes:{}
		});
	
	// remove parts before begining of relative home directory
	if (i >= 0) startPath = filePath.slice(i-1);

	// split remaining parts
	startPath = startPath.split(path.sep);

	if (currentStat.isDirectory()) {
		//stage directory in index file
		if (!previousStat || (currentStat.mtime.getTime() > previousStat.mtime.getTime())) {
			startPath = startPath.join('/')
			// create path object in index if doesn't exist
			if (!index.get(startPath)) index.put(startPath, {
					mode: 040000,
					name: name,
					nodes: {}
				});
			console.log('ADDED FOLDER: ', name);
		}
	} else if (currentStat.isFile()) {
		// remove filename portion
		startPath.splice(startPath.length-1);
		// join to make relative path without filename
		startPath = startPath.join('/');
		if (!previousStat || (currentStat.mtime.getTime() > previousStat.mtime.getTime())) {
			//stage file within the index sub object associated with the subdirectory
			saveBlob(filePath, currentStat, previousStat, function(err, blobHash) {
				var t = index.get(startPath);
				var b = index.get(base);
				if (err) throw ('failed to read file: ', name, ' - ', err);
				t.nodes[name] = {
					mode: 0100644,
					hash: blobHash
				};
				console.log('ADDED FILE: ', name, blobHash);
				index.put(startPath, t);
				if (!interval && !b.active) {
					interval = setTimeout(commitChanges, timer);
				} else if (interval && !b.active) {
					interval = clearTimeout(interval);
					interval = setTimeout(commitChanges, timer);
				}
			});
		}
	} else {
		console.log('Not sure what was created: ', filePath, currentStat);
	}
}

function saveBlob(filePath, currentStat, previousStat, i, cb) {
	var name = path.basename(filePath);
	var dir = path.dirname(filePath);
	var ebusy = /EBUSY/ig;

	if (typeof i === 'function') {
		cb = i;
		i = 0;
	}

	if (!previousStat || currentStat.size !== previousStat.size) {
		console.log('READ FILE: ', filePath)
		nfs.readFile(filePath, function(err, data) {
			if (i === 3 && err) throw err;
			if (err && ebusy.test(err.message)) return setTimeout(saveBlob, 1000, filePath, currentStat, previousStat, ++i, cb);

			i = 0;
			repo.saveAs('blob', data, function(err, blobHash) {
				if (err) return cb(err); //throw 'Failed to save blob: ' + err.message
				return cb(null, blobHash);
			});
		});
	}
}

function commitChanges() {
	var keys = Object.keys(index.flatten(index)).sort(pathCmp)
	, tree = {}
	, base = path.basename(home)
	, b = index.get(base);

	b.active = true;
	index.put(base, b);
	interval = clearTimeout(interval);

	async.eachSeries(keys, saveTree, function(err) {
		//completed building commit tree
		//save tree as a commit object
		b = index.get(base);
		var commit = {
			tree: b.hash,
			parent: __parent,
			author: commiter,
			commiter: commiter,
			message: 'some commit message'
		};
		repo.saveAs('commit', commit, function(err, commitHash) {
			if (err) throw err;
			__parent = commitHash;
			repo.updateHead(commitHash, moveHead);
			b.active = false;
			index.put(base, b);
			console.log('commit saved: ', commitHash);
			//console.log(err, util.inspect(index, {depth: 5}));
		});
	});
}

function saveTree(item, done) {
	var t = index.get(item);
	var p = item.split('/');
	var prev, name;

	name = p.pop();
	prev = p.join('/');

console.log('SAVE TREE: ', name, ' - ',prev, ' : ', t.nodes)
	repo.saveAs('tree', t.nodes, function(err, treeHash) {
		if (err) {
			console.log('ERROR: ', err);
			return done(err);
		}
		p = index.get(prev);
	console.log('PREV: ', p);
		if (p) {
			p.nodes[name] = {
				hash: treeHash,
				mode: 040000
			};
			index.put(prev, p);
		} else {
			t.hash = treeHash;
			index.put(item, t);
		}
		return done();
	});
}

function moveHead(err) {
	console.log('updated HEAD');
	if (err) throw err;
}

// Sort values from longest to shortest
function pathCmp(a, b) {
	a += "/"; b += "/";
	return a > b ? -1 : a < b ? 1 : 0;
}