FROM node:20-alpine AS base
WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
