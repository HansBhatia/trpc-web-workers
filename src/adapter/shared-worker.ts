import { AnyProcedure, AnyRouter } from "@trpc/server";
import { TRPC_ERROR_CODES_BY_KEY } from "@trpc/server/rpc";
import { workerMessageRequest, workerMessageResponse } from "../types";
import { getErrorFromUnknown } from "../utils/error";

// THIS INITIALIZES THE WORKER
export const sharedWorkerAdapter = <TRouter extends AnyRouter>(opts: {
  router: TRouter;
}) => {
  const router = opts.router;
  const { transformer } = router._def._config;
  const ctx: SharedWorker = self as unknown as SharedWorker;
  ctx.addEventListener("connect", (_e: unknown) => {
    const event: MessageEvent = _e as MessageEvent;
    const port: MessagePort = event.ports[0] as unknown as MessagePort;

    port.onmessage = async (event: MessageEvent<workerMessageRequest>) => {
      const { id, params } = event.data.trpc;

      const caller = router.createCaller({}); //TODO: No context for now
      const segments = params.path.split(".");
      const procedureFn = segments.reduce(
        (acc, segment) => acc[segment],
        caller as any
      ) as AnyProcedure;

      try {
        const result = await procedureFn(
          transformer.input.deserialize(params.input)
        );

        const res: workerMessageResponse = {
          trpc: {
            id,
            result: {
              data: transformer.output.serialize(result),
              type: "data",
            },
          },
        };

        port.postMessage(res);
      } catch (err) {
        console.log(err);
        const error = getErrorFromUnknown(err);
        console.log(error);
        const res: workerMessageResponse = {
          trpc: {
            id,
            error: {
              code: TRPC_ERROR_CODES_BY_KEY[error.code],
              message: error.message,
              data: {
                ...error,
              },
            },
          },
        };
        port.postMessage(res);
      }
    };
  });
};
