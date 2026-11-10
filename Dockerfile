FROM node:22-alpine AS dependencies
RUN apk add --no-cache git openssh-client

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development

COPY . .
RUN chmod +x docker-entrypoint.sh scripts/docs-renderer.mjs \
    && ln -s /app/scripts/docs-renderer.mjs /usr/local/bin/docs-renderer
EXPOSE 4321
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["docs-renderer", "preview"]

# The same image serves development and writes static output at runtime.
FROM development AS renderer
