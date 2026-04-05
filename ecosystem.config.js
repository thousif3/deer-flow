module.exports = {
  apps: [
    {
      name: "talon-flow-api",
      cwd: "/home/sandbox/talon-flow/backend",
      script: "/home/sandbox/talon-flow/venv/bin/python3",
      args: "-m uvicorn app.gateway.app:app --host 0.0.0.0 --port 8000", 
      // NOTE: Change 'app.gateway.app:app' to 'src.server:app' if you have the old layout!
      env: {
        DEER_FLOW_CONFIG_PATH: "/home/sandbox/talon-flow/backend/config.yaml",
        PYTHONPATH: "/home/sandbox/talon-flow/backend/packages/harness:/home/sandbox/talon-flow/backend",
        GEMINI_API_KEY: "AIzaSyC0-W3jTVCGViIIoBopfpeTMWb7sWf2W5o"
      },
      autorestart: true,
      max_restarts: 10
    }
  ]
};
