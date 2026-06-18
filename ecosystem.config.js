// PM2 process config — single fork-mode instance.
// Start:   pm2 start ecosystem.config.js
// Reload:  pm2 reload spillsnap-api   (done by deploy/deploy.sh)
// NOTE: fork mode + 1 instance is intentional — the app has @Cron jobs
// (notifications, cleanup) that must run exactly once. Switching to cluster
// mode would fire every cron in every worker; guard them by NODE_APP_INSTANCE
// before doing that.
module.exports = {
  apps: [
    {
      name: 'spillsnap-api',
      cwd: '/opt/spillsnap-backend',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      // NestJS ConfigModule loads .env from cwd; PORT/NODE_ENV above are belt-and-braces.
      env_file: '.env',
      max_memory_restart: '1G', // restart if a leak pushes it past 1GB
      autorestart: true,
      time: true, // prefix logs with timestamps
    },
  ],
};
