var platform = require('git-node-platform')
  , jsGit = require('js-git')(platform)
  , fsDb = require('git-fs-db')(platform)
  , fs = platform.fs
  , nfs = require('graceful-fs')
  , watchr = require('watchr')
  , path = require('path')
  , trie = require('path-trie')
  , config = require('./config').config;

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
			mode:040000,
			nodes:[]
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
					nodes: []
				});
		}
	} else if (currentStat.isFile()) {
		// remove filename portion
		startPath.splice(startPath.length-1);
		// join to make give relative path without filename
		startPath = startPath.join('/');
		if (!previousStat || (currentStat.mtime.getTime() > previousStat.mtime.getTime())) {
			//stage file within the index sub object associated with the subdirectory
			saveBlob(filePath, currentStat, previousStat, function(err, blobHash) {
				var t = index.get(startPath);
				if (err) throw ('failed to read file: ', name, ' - ', err);
				t.nodes.push({
					name: name,
					mode: 0100644,
					hash: blobHash
				});
				index.put(startPath, t);
				console.log(util.inspect(index, {depth: 5}));
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
		nfs.readFile(filePath, function(err, data) {
			if (i === 3 && err) throw err;
			if (err && ebusy.test(err.message)) return setTimeout(saveBlob, 1000, filePath, currentStat, previousStat, ++i, cb);

			i = 0;
			repo.saveAs('blob', data, function(err, blobHash) {
				if (err) return cb(err); //throw 'Failed to save blob: ' + err.message
				return cb(null, blobHash);
/*				var tree = {}, blob = {};
				tree[name] = {
					mode: 0100644,
					hash: blobHash
				};
				blob = {
					name: name,
					dir: dir,
					tree: tree,
					stat: currentStat
				};
				console.log('Saved blob: ', blobHash);
				if (blobHash) commitChanges(blob);
*/
			});
		});
	}
}

function commitChanges(blob) {
	var keys = Object.keys(index.flatten(index)).sort(pathCmp);
	var tree = {};

	async.each(keys, saveTree, function(err) {
		//completed building commit tree
		//save tree as a commit object
	});
/*
	repo.saveAs('tree', blob.tree, function(err, treeHash) {
		var node;
		if (err) throw err;
//		console.log('Saved tree: ', treeHash);
		nodes = index[blob.dir] || [];
		console.log(nodes);
		nodes.push({
			hash: treeHash,
			node: blob.tree
		});
		var commit = {
			tree: treeHash,
			parent: __parent,
			author: commiter,
			commiter: commiter,
			message: blob.name + ' - ' + blob.stat.mtime
		};
		repo.saveAs('commit', commit, function(err, commitHash) {
			if (err) throw err;
//			console.log('Saved commit: ', commitHash);
			__parent = commitHash;
			repo.updateHead(commitHash, moveHead);
		});
	});
*/
}

function saveTree(item, done) {
	var t = index.get(item);
	var p = item.split('/');
	var prev, name;

	name = p.pop();
	prev = p.join('/');

	repo.saveAs('tree', t.nodes, function(err, treeHash) {
		if (err) return done(err)
		t.hash = treeHash;
		t.name = name;
		t.mode = 040000;
		index.put(item, t);
		p = index.get(prev);
		p.nodes.push({
			t.hash,
			t.name,
			t.mode
		});
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