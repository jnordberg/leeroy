
leeroy
======

Docker image build bot, because Docker Hub is too slow and Jenkins sucks.

### Features

  * Automatically builds and publishes Docker images for your GitHub branches
  * No spawning, uses libgit2 and Docker sockets
  * Safely does concurrent builds
  * Reports build status via optional Slack integration
  * Easy to setup


Quick start
-----------

Start a leeroy server:

```
docker run -d -p 8080:8080 --name leeroy \
    -e DOCKER_AUTH="{\"username\":\"foo\",\"password\":\"bar\"}" \
    -e SLACK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
    -e GITHUB_SECRET=supersecret \
    -v /var/run/docker.sock:/var/run/docker.sock \
    jnordberg/leeroy
```

Go to `https://github.com/<user>/<repo>/settings/hooks/new` for each repository you want to build and add `<leeroy-server-address>/hooks/github` with the content-type `appplication/json` and secret set to the same as `GITHUB_SECRET` above.

<img width="751" alt="hook" src="https://user-images.githubusercontent.com/95886/35487081-fb16ac72-0477-11e8-84a0-517cd2e65f87.png">


*Enjoy your fast automated builds!*


Configuration
-------------

The docker socket defaults to `/var/run/docker.sock` and can be set just like the docker cli using the `DOCKER_HOST` environment variable.

Repository authentication is passed as a JSON encoded string in `DOCKER_AUTH`.
E.g. `DOCKER_AUTH="{\"username\":\"foo\",\"password\":\"bar\"}"`

See [config/default.toml](config/default.toml) for more options and [config/custom-environment-variables.toml](config/custom-environment-variables.toml) for the corresponding env vars.


Developing
----------

Checkout the repository and run `make devserver`, see the [Makefile](Makefile) for more useful commands. Use [ngrok](https://ngrok.com) to conveniently test webhooks.


---

*At least I ain't chicken*
