import http from "k6/http";
import { sleep } from "k6";

export const options = {
  vus: 200, // Virtual Users
  duration: "2m",
};

// k6 requires the test body to be the module's default export.
// eslint-disable-next-line import/no-anonymous-default-export
export default function () {
  http.get("http://localhost:3000");
  sleep(1);
}
