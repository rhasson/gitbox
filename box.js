var platform = require('git-node-platform')
  , jsGit = require('js-git')(platform)
  , fsDb = require('git-fs-db')(platform)
  , fs = platform.fs
  , nfs = require('graceful-fs')
  , watchr = require('watchr')
  , path = require('path');

// Create a filesystem backed bare repo
var repo = jsGit(fsDb(fs("home.git")))
  , home = process.argv.splice(2)[0]
  , index = {}
  , commiter = {name: 'Roie', email: 'rhasson@gmail.com'}
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
					index['__parent'] = hash;
				} else {
					repo.setHead("master", function (err) {
						if (err) throw err;
						console.log('set HEAD to master');
						index['__parent'] = null;
					});
				} 
			});
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
	ignoreHiddenFiles: true,
	ignoreCustomPatterns: /\.(tmp)/i
});

function handleCreate(filePath, currentStat, previousStat) {
	console.log('handleCreate: ', filePath);
	
	if (currentStat.isDirectory()) {
		//if (!(base in index)) index[base] = {};
	} else if (currentStat.isFile()) {
		saveBlob(filePath, currentStat, previousStat);
	} else {
		console.log('Not sure what was created: ', filePath, currentStat);
	}
}

function handleUpdate(filePath, currentStat, previousStat) {
	console.log('handleUpdate: ', filePath);

	if (currentStat.isDirectory()) {
		//dir
	} else if (currentStat.isFile()) {
		saveBlob(filePath, currentStat, previousStat);
	} else {
		console.log('Not sure what was created: ', filePath, currentStat);
	}
}

function handleDelete(filePath, currentStat, previousStat) {

}

function saveBlob(filePath, currentStat, previousStat, i) {
	var name = path.basename(filePath);
	var base = path.dirname(filePath);
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
					base: base,
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
		nodes = index[blob.base] || [];
		console.log(nodes);
		nodes.push({
			hash: treeHash,
			node: blob.tree
		});
		var commit = {
			tree: treeHash,
			parent: index['__parent'],
			author: commiter,
			commiter: commiter,
			message: blob.name + ' - ' + blob.stat.mtime
		};
		repo.saveAs('commit', commit, function(err, commitHash) {
			if (err) throw err;
//			console.log('Saved commit: ', commitHash);
			index['__parent'] = commitHash;
			repo.updateHead(commitHash, moveHead);
		});
	});
}

function moveHead(err) {
	console.log('updated HEAD');
	if (err) throw err;
}