FROM node:9-alpine

WORKDIR /app

# install build dependencies
RUN apk add --no-cache \
    bash \
    build-base \
    git \
    libgit2-dev \
    make \
    python

# install application dependencies
COPY package.json yarn.lock ./
RUN JOBS=max yarn install --non-interactive --frozen-lockfile

# copy in application source
COPY . .

# run tests and build typescript sources
RUN make lib ci-test

# prune modules
RUN yarn install --non-interactive --frozen-lockfile --production \
   && rm -r node_modules/nodegit/vendor

# copy built application to runtime image
FROM node:9-alpine
WORKDIR /app
RUN apk add --no-cache libgit2
COPY --from=0 /app/config config
COPY --from=0 /app/lib lib
COPY --from=0 /app/node_modules node_modules

# run in production mode on port 8080
EXPOSE 8080
ENV PORT 8080
ENV NODE_ENV production
CMD [ "node", "lib/app.js" ]
