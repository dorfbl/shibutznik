module.exports = {
  apps: [
    {
      name: "badat-api",
      script: "server/index.js",
      interpreter: "node",
      node_args: "--watch",
      env: {
        NODE_ENV: "development",
        API_PORT: "3015",
        PGHOST: "/var/run/postgresql",
        PGDATABASE: "badat_football",
        PGUSER: "root",
        WEB_ORIGIN: "https://shib.kefar-sava.co.il"
      },
      watch: ["server", "db"],
      ignore_watch: ["node_modules", "client"],
      autorestart: true
    },
    {
      name: "badat-web",
      script: "node_modules/vite/bin/vite.js",
      args: "client --host 0.0.0.0 --port 4215",
      env: {
        NODE_ENV: "development",
        VITE_API_URL: "https://shib.kefar-sava.co.il:3015"
      },
      watch: ["client"],
      ignore_watch: ["node_modules"],
      autorestart: true
    }
  ]
};
