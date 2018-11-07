FROM node:10-alpine

WORKDIR /app

# install build dependencies
RUN apk add --no-cache \
    bash \
    build-base \
    curl-dev \
    git \
    libgit2-dev \
    make \
    python

# install application dependencies
COPY package.json yarn.lock ./
RUN BUILD_ONLY=true JOBS=max yarn install --non-interactive --frozen-lockfile

# copy in application source
COPY . .

# run tests and build typescript sources
RUN make lib ci-test

# prune modules
RUN yarn install --non-interactive --frozen-lockfile --production \
   && rm -r node_modules/nodegit/vendor

# copy built application to runtime image
FROM node:10-alpine
WORKDIR /app
RUN apk add --no-cache \
    curl \
    libgit2 \
    openssh-client
COPY --from=0 /app/config config
COPY --from=0 /app/lib lib
COPY --from=0 /app/node_modules node_modules

# run in production mode by default
ENV NODE_ENV production

# start service
CMD [ "node", "lib/app.js" ]
