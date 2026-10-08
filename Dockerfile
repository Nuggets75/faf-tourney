# The image FAF's cluster runs (gitops-stack, apps/faf-tournaments).
#
# The code is copied in at build time instead of cloned at start, which is what
# docker-compose.yml does: a cluster has to know exactly which version it is
# running, and roll back to the previous one. docker-compose.yml stays for the
# current server until the move is done.
#
# Still zero runtime dependencies, so no npm install here either.
FROM node:24-alpine

WORKDIR /srv/app
COPY package.json server.js challonge.js ./
COPY lib ./lib
COPY public ./public

# db.json and the three image folders. Mounted as a persistent volume in the
# cluster; owned by the unprivileged `node` user the process runs as.
ENV PORT=8090 \
    DATA_DIR=/data \
    NODE_ENV=production
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 8090
CMD ["node", "server.js"]
