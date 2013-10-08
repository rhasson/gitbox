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
	var t
	  , name = path.basename(filePath)
	  , base = path.basename(home)
	  , ex_home = new RegExp('(' + base + ').*')
	  , startPath = name
	  , i = filePath.match(ex_home).index; // index of where home directory starts

	// create the index is it doesn't exist
	if (!trie.get(base)) index = trie.put(base, []);
	
	// remove parts before begining of relative home directory
	if (i >= 0) startPath = filePath.slice(i-1);

	// split remaining parts
	startPath = startPath.split(path.sep);

	if (currentStat.isDirectory()) {
		//stage directory in index file
		if (!previousStat || (currentStat.mtime.getTime() > previousStat.mtime.getTime())) {
			startPath = startPath.join('/')
			// create path object in index if doesn't exist
			if (!index.get(startPath)) index.put(startPath, []);
		}
	} else if (currentStat.isFile()) {
		// remove filename portion
		startPath.splice(startPath.length-1);
		// join to make give relative path without filename
		startPath = startPath.join('/');
		if (!previousStat || (currentStat.mtime.getTime() > previousStat.mtime.getTime())) {
			//stage file within the index sub object associated with the subdirectory
			t = index.get(startPath);
			t.push({
				name: name,
				mode: 0100644
			});
			index.put(startPath, t);
		}
	} else {
		console.log('Not sure what was created: ', filePath, currentStat);
	}
}

function saveBlob(filePath, currentStat, previousStat, i) {
	var name = path.basename(filePath);
	var dir = path.dirname(filePath);
	var ebusy = /EBUSY/ig;

	if (!previousStat || currentStat.size !== previousStat.size) {
		nfs.readFile(filePath, function(err, data) {
			if (i === 3 && err) throw err;
			if (err && ebusy.test(err.message)) return setTimeout(saveBlob, 1000, filePath, currentStat, previousStat, ++i);

			i = 0;
			repo.saveAs('blob', data, function(err, blobHash) {
				if (err) throw 'Failed to save blob: ' + err.message
				var tree = {}, blob = {};
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
			});
		});
	}
}

function commitChanges(blob) {
//	console.log('INDEX: ', index);
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
}

function moveHead(err) {
	console.log('updated HEAD');
	if (err) throw err;
}