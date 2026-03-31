#!/usr/bin/env node

const chokidar = require('chokidar');
const SftpClient = require('ssh2-sftp-client');
const { Client: SSHClient } = require('ssh2');
const path = require('path');
const fs = require('fs').promises;
const fsSynchronous = require('fs');
const { execSync } = require('child_process');

// Configuration
const CONFIG = {
  host: '192.168.1.1',  // Change to your router's IP
  port: 22,
  username: 'root',     // Change to your router's username
  password: '',         // Add your password or use privateKey
  // privateKey: require('fs').readFileSync('/path/to/private/key'),
  readyTimeout: 10000,
};

// Path mappings: local -> remote
const PATH_MAPPINGS = [
  {
    local: 'files/www/luci-static/resources/netstat',
    remote: '/www/luci-static/resources/netstat',
    description: 'NetStat widget CSS and resources'
  },
  {
    local: 'files/www/luci-static/resources/view/status/include/08_stats.js',
    remote: '/www/luci-static/resources/view/status/include/08_stats.js',
    description: 'Main widget file'
  },
  {
    local: 'files/usr/lib/lua/luci/controller/netstat.lua',
    remote: '/usr/lib/lua/luci/controller/netstat.lua',
    description: 'NetStat Lua controller with RPC handler'
  },
  {
    local: 'files/usr/lib/lua/luci/model/cbi/netstat',
    remote: '/usr/lib/lua/luci/model/cbi/netstat',
    description: 'NetStat CBI model files'
  },
  {
    local: 'files/usr/lib/lua/luci/view/netstat',
    remote: '/usr/lib/lua/luci/view/netstat',
    description: 'NetStat LuCI view templates'
  },
  {
    local: 'files/usr/lib/lua/luci/view/vnstat.htm',
    remote: '/usr/lib/lua/luci/view/vnstat.htm',
    description: 'Legacy vnStat view template'
  }
];

const BASE_DIR = __dirname;

function normalizeLocalPath(localPath) {
  return localPath.replace(/[\\/]+/g, path.sep);
}

class NetStatSync {
  constructor() {
    this.sftp = new SftpClient();
    this.ssh = new SSHClient();
    this.isConnected = false;
    this.reconnectTimeout = null;
    this.lastReloadTime = 0;
    this.reloadDebounceMs = 1000; // Debounce reloads to max 1 per second
  }

  async connect() {
    try {
      console.log(`🔌 Connecting to ${CONFIG.host}...`);
      await this.sftp.connect(CONFIG);
      this.ssh.connect(CONFIG);
      this.isConnected = true;
      console.log('✅ Connected to router\n');
    } catch (err) {
      console.error('❌ Connection failed:', err.message);
      this.isConnected = false;
      this.scheduleReconnect();
    }
  }

  async executeCommand(command) {
    return new Promise((resolve, reject) => {
      this.ssh.exec(command, (err, stream) => {
        if (err) return reject(err);
        
        let stdout = '';
        let stderr = '';
        
        stream.on('close', (code, signal) => {
          resolve({ code, stdout, stderr });
        });
        
        stream.on('data', (data) => {
          stdout += data.toString();
        });
        
        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    });
  }

  async reloadLuciUI() {
    const now = Date.now();
    if (now - this.lastReloadTime < this.reloadDebounceMs) {
      return; // Skip if reload was done recently
    }
    this.lastReloadTime = now;

    if (!this.isConnected) {
      console.log('⏭️  Skipping LuCI reload (not connected)\n');
      return;
    }

    try {
      console.log('🔄 Reloading LuCI UI...');
      const result = await this.executeCommand('service uhttpd restart && echo "LuCI reloaded"');
      
      if (result.code === 0) {
        console.log('✅ LuCI UI reloaded successfully\n');
      } else {
        console.log(`⚠️  Reload exit code: ${result.code}`);
        if (result.stderr) console.log(`   Error: ${result.stderr}\n`);
      }
    } catch (err) {
      console.error(`❌ Reload failed:`, err.message);
      if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        this.isConnected = false;
        this.scheduleReconnect();
      }
      console.log();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) return;
    
    console.log('⏳ Reconnecting in 5 seconds...\n');
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 5000);
  }

  async ensureConnection() {
    if (!this.isConnected) {
      await this.connect();
    }
    return this.isConnected;
  }

  getRemotePath(localPath) {
    const relativePath = normalizeLocalPath(path.relative(BASE_DIR, localPath));
    
    for (const mapping of PATH_MAPPINGS) {
      const localNormalized = normalizeLocalPath(mapping.local);
      
      if (mapping.isFile) {
        if (relativePath === localNormalized) {
          return mapping.remote;
        }
      } else {
        if (relativePath.startsWith(localNormalized)) {
          const subPath = relativePath.slice(localNormalized.length)
            .replace(/\\/g, '/')
            .replace(/^\//, '');
          return `${mapping.remote}${subPath ? '/' + subPath : ''}`;
        }
      }
    }
    
    return null;
  }

  async ensureRemoteDir(remotePath) {
    const dir = path.posix.dirname(remotePath);
    try {
      await this.sftp.mkdir(dir, true);
    } catch (err) {
      // Directory might already exist
      if (err.code !== 4) { // 4 = Failure
        console.error(`   ⚠️  Could not create directory ${dir}:`, err.message);
      }
    }
  }

  async uploadFile(localPath) {
    if (!await this.ensureConnection()) {
      console.log(`⏭️  Skipping ${localPath} (not connected)`);
      return;
    }

    const remotePath = this.getRemotePath(localPath);
    if (!remotePath) {
      console.log(`⏭️  Skipping ${localPath} (not in watched paths)`);
      return;
    }

    try {
      console.log(`📤 Uploading: ${path.basename(localPath)}`);
      console.log(`   Local:  ${localPath}`);
      console.log(`   Remote: ${remotePath}`);
      
      await this.ensureRemoteDir(remotePath);
      await this.sftp.put(localPath, remotePath);
      
      console.log(`✅ Synced successfully`);
      await this.reloadLuciUI();
    } catch (err) {
      console.error(`❌ Upload failed:`, err.message);
      if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        this.isConnected = false;
        this.scheduleReconnect();
      }
      console.log();
    }
  }

  async deleteFile(localPath) {
    if (!await this.ensureConnection()) {
      console.log(`⏭️  Skipping deletion of ${localPath} (not connected)`);
      return;
    }

    const remotePath = this.getRemotePath(localPath);
    if (!remotePath) return;

    try {
      console.log(`🗑️  Deleting: ${remotePath}`);
      await this.sftp.delete(remotePath);
      console.log(`✅ Deleted successfully\n`);
    } catch (err) {
      console.error(`❌ Delete failed:`, err.message, '\n');
    }
  }

  startWatching() {
    const watchPaths = PATH_MAPPINGS.map(m => 
      path.join(BASE_DIR, normalizeLocalPath(m.local))
    );

    console.log('👀 Watching for changes:');
    PATH_MAPPINGS.forEach(m => {
      console.log(`   ${m.description}: ${m.local}`);
    });
    console.log();

    const watcher = chokidar.watch(watchPaths, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    watcher
      .on('add', filePath => {
        console.log(`➕ File added: ${path.basename(filePath)}`);
        this.uploadFile(filePath);
      })
      .on('change', filePath => {
        console.log(`✏️  File changed: ${path.basename(filePath)}`);
        this.uploadFile(filePath);
      })
      .on('unlink', filePath => {
        console.log(`➖ File deleted: ${path.basename(filePath)}`);
        this.deleteFile(filePath);
      })
      .on('error', error => {
        console.error('❌ Watcher error:', error);
      });

    console.log('✨ Watch mode active. Press Ctrl+C to stop.\n');
  }

  async forceSync() {
    if (!await this.ensureConnection()) {
      console.log('❌ Cannot force sync - not connected to router\n');
      return false;
    }

    console.log('🔄 Force syncing all files...\n');
    let uploadCount = 0;
    let errorCount = 0;

    for (const mapping of PATH_MAPPINGS) {
      const localPath = path.join(BASE_DIR, normalizeLocalPath(mapping.local));
      
      try {
        if (!fsSynchronous.existsSync(localPath)) {
          console.log(`⏭️  Skipping ${mapping.description} (path not found): ${localPath}`);
          continue;
        }

        const stats = await fs.stat(localPath);

        if (stats.isFile()) {
          // Single file mapping
          await this.uploadFile(localPath);
          uploadCount++;
          continue;
        }

        if (stats.isDirectory()) {
          // Directory mapping - recursively upload all files
          const files = await this.getAllFiles(localPath);
          for (const filePath of files) {
            try {
              await this.uploadFile(filePath);
              uploadCount++;
            } catch (err) {
              console.error(`❌ Failed to upload ${filePath}: ${err.message}`);
              errorCount++;
            }
          }
          continue;
        }

        console.log(`⏭️  Skipping ${mapping.description} (unsupported path type): ${localPath}`);
      } catch (err) {
        console.error(`❌ Error processing ${mapping.description}: ${err.message}`);
        errorCount++;
      }
    }

    console.log(`\n✅ Force sync complete! Uploaded: ${uploadCount} files${errorCount > 0 ? `, Errors: ${errorCount}` : ''}\n`);
    return true;
  }

  async getAllFiles(dir) {
    const files = [];
    
    const items = await fs.readdir(dir, { withFileTypes: true });
    
    for (const item of items) {
      if (item.name.startsWith('.')) continue; // Skip hidden files
      
      const fullPath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        files.push(...await this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  async cleanup() {
    console.log('\n🛑 Shutting down...');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    if (this.isConnected) {
      await this.sftp.end();
      this.ssh.end();
    }
    console.log('👋 Goodbye!');
    process.exit(0);
  }
}

// Main
async function main() {
  console.log('🚀 NetStat Sync - Starting...\n');

  const sync = new NetStatSync();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => sync.cleanup());
  process.on('SIGTERM', () => sync.cleanup());

  await sync.connect();
  
  // Check for force sync flag
  const args = process.argv.slice(2);
  if (args.includes('--force-sync') || args.includes('-f')) {
    const success = await sync.forceSync();
    if (success) {
      console.log('Starting watch mode...\n');
      sync.startWatching();
    } else {
      await sync.cleanup();
    }
  } else {
    sync.startWatching();
  }
}

main().catch(err => {
  console.error('💥 Fatal error:', err.message);
  // Don't exit - keep watching
  setTimeout(() => {
    console.log('🔄 Restarting watcher...\n');
    // Try to reconnect
  }, 3000);
});
