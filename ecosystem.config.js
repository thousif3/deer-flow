module.exports = {
  apps: [
    {
      name: "talon-flow-api",
      cwd: "/home/sandbox/talon-flow/backend",
      script: "/home/sandbox/talon-flow/venv/bin/python3",
      args: "-m uvicorn app.gateway.app:app --host 0.0.0.0 --port 8000", 
      env: {
        TALON_FLOW_CONFIG_PATH: "/home/sandbox/talon-flow/backend/config.yaml",
        PYTHONPATH: "/home/sandbox/talon-flow/backend/packages/harness:/home/sandbox/talon-flow/backend",
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY
      },
      autorestart: true,
      max_restarts: 10
    },
    {
      name: "talon-scheduler",
      cwd: "/home/sandbox/job-engine",
      script: "src/scheduler.mjs",
      interpreter: "node",
      args: "--env-file=.env",
      env: {
        GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        NODE_ENV: "production"
      },
      autorestart: true
    },
    {
      name: "talon-frontend",
      cwd: "/home/sandbox/talon-flow/frontend",
      script: "npm",
      args: "run dev -- -p 3001",
      env: {
        NODE_ENV: "development"
      },
      autorestart: true
    }
  ]
};
