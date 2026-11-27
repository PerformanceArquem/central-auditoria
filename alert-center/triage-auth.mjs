// UI invalidation only. Authorization remains with getUser and the server.
export function createTriageAuthGuard(invalidate) {
  let userId;
  return (event, session) => {
    const next=typeof session?.user?.id==='string'&&session.user.id.trim()?session.user.id:null;
    if(event==='SIGNED_OUT') {userId=null;invalidate();return;}
    if(event==='USER_UPDATED'||event==='PASSWORD_RECOVERY') {userId=next;invalidate();return;}
    if(!['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED'].includes(event))return;
    const changed=userId!==undefined&&userId!==next;
    userId=next;
    if(changed||(!next&&event!=='INITIAL_SESSION'))invalidate();
  };
}
