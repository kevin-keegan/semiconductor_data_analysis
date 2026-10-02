import { Container, getContainer } from "@cloudflare/containers";

export class EpaContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";

  envVars = {
    AWS_ACCESS_KEY_ID: this.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: this.env.AWS_SECRET_ACCESS_KEY,
    R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    R2_BUCKET_NAME: this.env.R2_BUCKET_NAME,
  };

  onStart() {
    console.log("EPA container started");
  }

  onStop() {
    console.log("EPA container stopped");
  }

  onError(error) {
    console.error("EPA container error", error);
  }
}

export default {
  async fetch(request, env) {
    const container = getContainer(env.EPA_CONTAINER, "epa-singleton");
    return container.fetch(request);
  },
};
