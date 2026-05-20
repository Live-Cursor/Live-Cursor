FROM node:20-alpine

# Install build tools for better-sqlite3
RUN apk add --no-cache python3 make g++ 

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Environment variables
ENV PORT=1234
ENV DB_PATH=/app/data/live-cursor.db
ENV BACKUP_DIR=/app/backups

# Expose port
EXPOSE 1234

# Start the server
CMD ["npm", "start"]
