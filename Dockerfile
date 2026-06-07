FROM oven/bun:1.1-slim
WORKDIR /app
COPY bot/package.json ./
RUN bun install
COPY bot/ ./
EXPOSE 3000
CMD ["bun", "src/index.ts"]
