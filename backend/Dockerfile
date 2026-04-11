FROM node:20-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# /data is where the Railway Volume will be mounted.
# Create it so the app starts even before the volume is attached (local dev).
RUN mkdir -p /data/logs

EXPOSE 5001

CMD ["node", "src/index.js"]
