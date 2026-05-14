const { app, BrowserWindow } = require('electron');
const path = require('path');

// Accept self-signed certificates only for our internal server
const TRUSTED_HOSTS = ['192.168.1.48', 'localhost', '127.0.0.1'];

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Vault Jump Retro',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true
    }
  });

  // Allow self-signed cert only for our known internal hosts
  win.webContents.session.setCertificateVerifyProc((request, callback) => {
    if (TRUSTED_HOSTS.includes(request.hostname)) {
      callback(0); // accept
    } else {
      callback(-3); // use default verification
    }
  });

  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});