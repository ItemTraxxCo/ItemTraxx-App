import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import router from "./router";
import { initAuthListener, refreshAuthFromSession } from "./services/authService";

const bootstrap = async () => {
  await refreshAuthFromSession();
  initAuthListener();

  const app = createApp(App);
  app.use(router);
  app.mount("#app");
};

bootstrap();
