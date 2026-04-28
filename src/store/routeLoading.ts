import { reactive } from "vue";

const routeLoadingState = reactive({
  isLoading: false,
});

export const getRouteLoadingState = () => routeLoadingState;

export const startRouteLoading = () => {
  routeLoadingState.isLoading = true;
};

export const finishRouteLoading = () => {
  routeLoadingState.isLoading = false;
};
