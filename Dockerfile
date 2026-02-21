# Use Node.js LTS (Long Term Support) version
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install dependencies for better security and stability
# - dumb-init: proper signal handling for Node.js in containers
RUN apk add --no-cache dumb-init

# Copy package files first (better layer caching)
COPY package*.json ./

# Install production dependencies only
# For development, change to: RUN npm ci
RUN npm ci --omit=dev

# Copy application source
COPY *.js ./
COPY *.md ./
COPY *.json ./

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port (default is 3000, but can be overridden via env)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:${PORT:-3000}/', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "app.js"]
