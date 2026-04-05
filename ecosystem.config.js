module.exports = {
  apps: [
    {
      name: "deer-flow-api",
      cwd: "/home/sandbox/deer-flow/backend",
      script: "/home/sandbox/deer-flow/venv/bin/python3",
      args: "-m uvicorn app.gateway.app:app --host 0.0.0.0 --port 8000", 
      // NOTE: Change 'app.gateway.app:app' to 'src.server:app' if you have the old layout!
      env: {
        DEER_FLOW_CONFIG_PATH: "/home/sandbox/deer-flow/backend/config.yaml",
        PYTHONPATH: "/home/sandbox/deer-flow/backend/packages/harness:/home/sandbox/deer-flow/backend",
        GEMINI_API_KEY: "AIzaSyC0-W3jTVCGViIIoBopfpeTMWb7sWf2W5o"
      },
      autorestart: true,
      max_restarts: 10
    }
  ]
};
