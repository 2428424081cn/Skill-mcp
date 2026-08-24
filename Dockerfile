FROM node:24-alpine

WORKDIR /app

# Copy dependency configs
COPY package.json tsconfig.json ./

# Copy source code and skill definitions
COPY src/ ./src/
COPY skills/ ./skills/
COPY data/ ./data/

# Expose MCP HTTP port
EXPOSE 3000

# Default to running with HTTP transport enabled
CMD ["node", "src/main.ts", "--http", "--host", "0.0.0.0", "--port", "3000"]
