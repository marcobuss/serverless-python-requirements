const fse = require('fs-extra');
const path = require('path');
const {spawnSync} = require('child_process');
const isWsl = require('is-wsl');
const {quote} = require('shell-quote');

/**
 * pip install the requirements to the .serverless/requirements directory
 */
function installRequirements() {
  const dotSlsReqs = '.serverless/requirements.txt';
  let fileName = this.options.fileName;
  if (this.options.usePipenv && fse.existsSync(path.join(this.servicePath, 'Pipfile'))) {
    fileName = dotSlsReqs;
  }

  if (!fse.existsSync(path.join(this.servicePath, fileName))) {
    return;
  }

  this.serverless.cli.log(`Installing required Python packages with ${this.options.pythonBin}...`);

  // In case the requirements file is a symlink, copy it to .serverless/requirements.txt
  // if using docker to avoid errors
  if (this.options.dockerizePip && fileName !== dotSlsReqs) {
    fse.ensureDirSync(path.join(this.servicePath, '.serverless'));
    fse.copySync(fileName, dotSlsReqs);
    fileName = dotSlsReqs;
  }

  let cmd;
  let options;
  let pipCmd = [
    this.options.pythonBin, '-m', 'pip', '--isolated', 'install',
    '-t', '.serverless/requirements', '-r', fileName,
    ...this.options.pipCmdExtraArgs,
  ];
  if (!this.options.dockerizePip) {
    // Check if pip has Debian's --system option and set it if so
    const pipTestRes = spawnSync(
      this.options.pythonBin, ['-m', 'pip', 'help', 'install']);
    if (pipTestRes.error) {
      if (pipTestRes.error.code === 'ENOENT') {
        throw new Error(`${this.options.pythonBin} not found! ` +
                      'Try the pythonBin option.');
      }
      throw new Error(pipTestRes.error);
    }
    if (pipTestRes.stdout.toString().indexOf('--system') >= 0) {
      pipCmd.push('--system');
    }
  }
  if (this.options.dockerizePip) {
    cmd = 'docker';

    this.serverless.cli.log(`Docker Image: ${this.options.dockerImage}`);

    // Determine os platform of docker CLI from 'docker version'
    options = ['version', '--format', '{{with .Client}}{{.Os}}{{end}}'];
    const ps = spawnSync(cmd, options, {'timeout': 10000, 'encoding': 'utf-8'});
    if (ps.error) {
      if (ps.error.code === 'ENOENT') {
        throw new Error('docker not found! Please install it.');
      }
      throw new Error(ps.error);
    } else if (ps.status !== 0) {
      throw new Error(ps.stderr);
    }

    let bindPath;
    const cliPlatform = ps.stdout.trim();
    if (process.platform === 'win32') {
      bindPath = this.servicePath.replace(/\\([^\s])/g, '/$1');
      if (cliPlatform === 'windows') {
        bindPath = bindPath.replace(/^\/(\w)\//i, '$1:/');
      }
    } else if (isWsl) {
      bindPath = this.servicePath.replace(/^\/mnt\//, '/');
      if (cliPlatform === 'windows') {
        bindPath = bindPath.replace(/^\/(\w)\//i, '$1:/');
      }
    } else {
      bindPath = this.servicePath;
    }

    options = [
      'run', '--rm',
      '-v', `${bindPath}:/var/task:z`,
    ];
    if(this.options.dockerSsh) {
      // Mount necessary ssh files to work with private repos
      options.push('-v', `${process.env.HOME}/.ssh/id_rsa:/root/.ssh/id_rsa:z`);
      options.push('-v', `${process.env.HOME}/.ssh/known_hosts:/root/.ssh/known_hosts:z`);
      options.push('-v', `${process.env.SSH_AUTH_SOCK}:/tmp/ssh_sock:z`);
      options.push('-e', 'SSH_AUTH_SOCK=/tmp/ssh_sock');
    }
    if (process.platform === 'linux') {
      // Set the ownership of the .serverless/requirements folder to current user
      pipCmd = quote(pipCmd);
      chownCmd = quote(['chown', '-R', `${process.getuid()}:${process.getgid()}`,
                        '.serverless/requirements']);
      pipCmd = ['/bin/bash', '-c', '"' + pipCmd + ' && ' + chownCmd + '"'];
    }
    options.push(this.options.dockerImage);
    options.push(...pipCmd);
  } else {
    cmd = pipCmd[0];
    options = pipCmd.slice(1);
  }
  const res = spawnSync(cmd, options, {cwd: this.servicePath, shell: true});
  if (res.error) {
    if (res.error.code === 'ENOENT') {
      if (this.options.dockerizePip) {
        throw new Error('docker not found! Please install it.');
      }
      throw new Error(`${this.options.pythonBin} not found! Try the pythonBin option.`);
    }
    throw new Error(res.error);
  }
  if (res.status !== 0) {
    throw new Error(res.stderr);
  }
};

module.exports = {installRequirements};
