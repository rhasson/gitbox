var platform = require('git-node-platform')
  , jsGit = require('js-git')(platform)
  , fsDb = require('git-fs-db')(platform)
  , fs = platform.fs
  , nfs = require('fs');

var repo = jsGit(fsDb(fs("home.git")))
  , hash = process.argv.splice(2)[0]
  , home = process.cwd() + '/home/';

repo.loadAs('commit', hash, onCommit);

function onCommit(err, commit, commitHash) {
	if (!err && commit && commitHash) repo.loadAs('tree', commit.tree, onTree);
	else throw err;
}

function onTree(err, tree) {
	var t,s;
	if (!err && tree) {
		t = tree[0];
		console.log('TREE: ', tree)
		repo.loadAs('blob', t.hash, function(err, blob){
			if (!err && blob) {
				if (nfs.existsSync(home+t.name)) {
					nfs.unlinkSync(home+t.name);
					s = nfs.writeFileSync(home+t.name, blob);
					if (!s) console.log('Switched to ', t.name);
					else console.log('error: ', s);
				}
			} else throw err;
		});
	} else throw err;
}

