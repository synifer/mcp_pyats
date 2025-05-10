FROM node:20

WORKDIR /app

RUN npm install -g pnpm

COPY package*.json tsconfig.json ./

# 🚨 REMOVE the cached SDK version and re-add the correct one
RUN pnpm remove @modelcontextprotocol/sdk && pnpm add @modelcontextprotocol/sdk@1.11.0
RUN pnpm add zod-to-json-schema
RUN rm -rf node_modules pnpm-lock.yaml
RUN pnpm install
RUN cat node_modules/@modelcontextprotocol/sdk/package.json | grep version
RUN pnpm install --save-dev @types/json-schema
RUN pnpm add fastify

COPY ./src ./src

# Compile TypeScript
RUN pnpm run build

# Debug: check build output
RUN ls -l build

RUN npm install -g dotenv-cli

EXPOSE 3000

ENTRYPOINT ["node", "build/index.js"]
