FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY server.js .
COPY src ./src

EXPOSE 80

CMD ["node", "server.js"]
