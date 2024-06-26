import { verifyMessage } from "ethers/lib/utils";
import { getGiftCardOrderId, getMessageToSign } from "../shared/helpers";
import { RedeemCode } from "../shared/types";
import { getTransactionFromOrderId } from "./get-order";
import { commonHeaders, getAccessToken, getBaseUrl } from "./helpers";
import { AccessToken, Context, ReloadlyFailureResponse, ReloadlyRedeemCodeResponse } from "./types";
import { validateEnvVars, validateRequestMethod } from "./validators";

export async function onRequest(ctx: Context): Promise<Response> {
  try {
    validateRequestMethod(ctx.request.method, "GET");
    validateEnvVars(ctx);

    const accessToken = await getAccessToken(ctx.env);

    const { searchParams } = new URL(ctx.request.url);
    const transactionId = Number(searchParams.get("transactionId"));
    const signedMessage = searchParams.get("signedMessage");
    const wallet = searchParams.get("wallet");
    const permitSig = searchParams.get("permitSig");

    if (isNaN(transactionId) || !(transactionId && signedMessage && wallet && permitSig)) {
      throw new Error(
        `Invalid query parameters: ${{
          transactionId,
          signedMessage,
          wallet,
          permitSig,
        }}`
      );
    }

    const errorResponse = Response.json({ message: "Given details are not valid to redeem code." }, { status: 403 });

    if (verifyMessage(getMessageToSign(transactionId), signedMessage) != wallet) {
      console.error(
        `Signed message verification failed: ${JSON.stringify({
          signedMessage,
          transactionId,
        })}`
      );
      return errorResponse;
    }

    const orderId = getGiftCardOrderId(wallet, permitSig);
    const order = await getTransactionFromOrderId(orderId, accessToken);

    if (order.transactionId != transactionId) {
      console.error(
        `Given transaction does not match with retrieved transactionId using generated orderId: ${JSON.stringify({
          transactionId,
          orderId,
          transactionIdFromOrder: order.transactionId,
        })}`
      );
      return errorResponse;
    }

    const redeemCode = await getRedeemCode(transactionId, accessToken);
    return Response.json(redeemCode, { status: 200 });
  } catch (error) {
    console.error("There was an error while processing your request.", error);
    return Response.json({ message: "There was an error while processing your request." }, { status: 500 });
  }
}

export async function getRedeemCode(transactionId: number, accessToken: AccessToken): Promise<RedeemCode[]> {
  const url = `${getBaseUrl(accessToken.isSandbox)}/orders/transactions/${transactionId}/cards`;
  console.log(`Retrieving redeem codes from ${url}`);
  const options = {
    method: "GET",
    headers: {
      ...commonHeaders,
      Authorization: `Bearer ${accessToken.token}`,
    },
  };

  const response = await fetch(url, options);
  const responseJson = await response.json();

  if (response.status != 200) {
    throw new Error(
      `Error from Reloadly API: ${JSON.stringify({
        status: response.status,
        message: (responseJson as ReloadlyFailureResponse).message,
      })}`
    );
  }
  console.log("Response status", response.status);
  console.log(`Response from ${url}`, responseJson);

  return responseJson as ReloadlyRedeemCodeResponse;
}
