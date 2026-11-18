export async function recoverSponsoredOrder({status,submit}){
  try{return await status();}
  catch(error){
    // Missing is different from unknown. submit must reuse the saved signed envelope.
    if(!/^Relay HTTP 404: [a-z_]+$/.test(error.message))throw error;
    return submit();
  }
}
