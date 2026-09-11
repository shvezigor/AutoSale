# AutoSale automatic deployment

The GitHub Actions workflow in `.github/workflows/ci-deploy.yml` verifies every
pull request and every push to `master`. Production deployment remains disabled
until a real server is prepared and the repository variable below is enabled.

## One-time server setup

1. Install Git, Docker Engine, the Docker Compose plugin, and `curl` on a Linux
   server.
2. Create a dedicated non-root deploy user that can run Docker without `sudo`.
3. Clone this repository into a dedicated absolute directory, for example
   `/srv/autosale`. For a private repository, give the server its own read-only
   GitHub deploy key; the server must be able to run `git fetch origin master`
   without an interactive password.
4. Create `/srv/autosale/.env` from `.env.example` and place all production
   secrets there. Set `NODE_ENV=production`. Never commit that file.
5. If Google service-account access is used, place the JSON credential at
   `/srv/autosale/secrets/google-service-account.json` and restrict its file
   permissions.
6. Run `sh infra/scripts/deploy.sh` once on the server and verify the public
   health URL.

The server checkout must remain deployment-only. Local edits to tracked files
stop the automated deployment instead of overwriting them.

## GitHub production configuration

Create a GitHub Environment named `production`. Store these Environment secrets:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | Server hostname or IP address |
| `DEPLOY_PORT` | SSH port; optional, defaults to `22` |
| `DEPLOY_USER` | Dedicated deploy user |
| `DEPLOY_PATH` | Absolute repository path, such as `/srv/autosale` |
| `DEPLOY_SSH_PRIVATE_KEY` | Private key used only for deployment |
| `DEPLOY_SSH_HOST_KEYS` | Pinned server host-key line from a trusted source |
| `DEPLOY_HEALTHCHECK_URL` | Optional public URL, such as `https://sales-aito.com/login` |

Add the public half of the deployment key to the deploy user's
`~/.ssh/authorized_keys`. Do not use a personal SSH key.

Finally create the repository variable `AUTO_DEPLOY_ENABLED` with the exact value
`true`. From that moment, a successful push to `master` deploys the exact tested
commit. Pull requests only run verification.

## Failure and rollback behavior

The deployment is serialized so two releases cannot update production at once.
It validates Docker Compose, builds images, starts dependencies, applies database
migrations, waits for all container health checks, and optionally checks the
public URL. A failure restores and rebuilds the previously running application
commit. Database migrations must remain backward-compatible and additive because
schema rollback is intentionally not automated.

To retry a release, open the `Verify and deploy` workflow in GitHub Actions and
run it manually from `master`. To deploy a previous commit deliberately, revert
the unwanted change on `master`; the resulting tested revert commit will deploy
normally.
