import React from "react";
import { createRoot } from "react-dom/client";
import { ThirdwebProvider } from "thirdweb/react";
import { client } from "./config";
import Faucet from "./Faucet";

createRoot(document.getElementById("root")).render(
  <ThirdwebProvider>
    <Faucet client={client} />
  </ThirdwebProvider>
);