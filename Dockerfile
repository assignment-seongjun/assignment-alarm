FROM node:18-alpine

WORKDIR /app

COPY web/package.json web/package-lock.json* ./
RUN npm install

COPY web/server.js ./server.js
COPY web/src ./src

EXPOSE 80

CMD ["node", "server.js"]
