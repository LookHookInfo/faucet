import React from "react";
import { createRoot } from "react-dom/client";
import { ThirdwebProvider } from "thirdweb/react";
import { client } from "./config";
import Faucet from "./Faucet";
import { ToastProvider } from "./Toast";

createRoot(document.getElementById("root")).render(
  <ThirdwebProvider>
    <ToastProvider>
      <Faucet client={client} />
    </ToastProvider>
  </ThirdwebProvider>
);