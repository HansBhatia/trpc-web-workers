import { DeferredPromise } from "@open-draft/deferred-promise";
import { TRPCClientError, TRPCLink } from "@trpc/client";
import { transformResult } from "@trpc/client/shared";
import { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { TRPCResponse } from "@trpc/server/rpc";
import {
  workerLinkOptions,
  workerMessageRequest,
  workerMessageResponse,
} from "../types";

export const workerLink = <TRouter extends AnyRouter>(
  opts: workerLinkOptions
): TRPCLink<TRouter> => {
  // here we just got initialized in the app - this happens once per app
  // useful for storing cache for instance
  const requestQueue = new Map<number, DeferredPromise<TRPCResponse>>();

  const worker = opts.createWorker();
  worker.port.start();
  // listen to messages from the worker
  worker.port.onmessage = (event: MessageEvent<workerMessageResponse>) => {
    const { id } = event.data.trpc;
    const deferred = requestQueue.get(id);
    if (!deferred) {
      throw new Error("Request not found");
    }
    deferred.resolve(event.data.trpc);
    requestQueue.delete(id);
  };

  return (runtime) => {
    console.log(runtime);
    return ({ op }) => {
      // this is when passing the result to the next link
      // each link needs to return an observable which propagates results
      return observable((observer) => {
        const { id, type, path } = op;
        const input = runtime.transformer.serialize(op.input);

        const promise = new DeferredPromise<TRPCResponse>();
        requestQueue.set(id, promise);

        const req: workerMessageRequest = {
          trpc: {
            id,
            method: type,
            params: { path, input },
          },
        };
        worker.port.postMessage(req);

        Promise.resolve(promise)
          .then((res) => {
            const transformed = transformResult(res, runtime);

            if (!transformed.ok) {
              // if an error is returned from the server, it comes here
              observer.error(TRPCClientError.from(transformed.error));
              return;
            }
            observer.next({
              result: transformed.result,
            });
            observer.complete();
          })
          .catch((cause) => {
            observer.error(TRPCClientError.from(cause, {}));
          });
        return () => {};
      });
    };
  };
};
