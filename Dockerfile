FROM node:24-slim
# fio and sysbench are optional but give industry-standard disk / CPU / memory numbers
RUN apt-get update && apt-get install -y --no-install-recommends fio sysbench procps util-linux iputils-ping ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p data
ENV NODE_ENV=production PORT=8090
EXPOSE 8090
CMD ["node", "server/index.mjs"]
