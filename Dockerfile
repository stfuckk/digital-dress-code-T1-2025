FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./

RUN npm install
COPY . .
RUN npm run download-models
RUN npm run build

FROM node:20-alpine AS preview

WORKDIR /app

COPY --from=builder /app/dist ./dist
EXPOSE 3333

CMD ["npm", "run", "preview", "--host=0.0.0.0", "--port=3333"]
