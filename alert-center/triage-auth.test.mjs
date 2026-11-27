import test from 'node:test';
import assert from 'node:assert/strict';
import {createTriageAuthGuard} from './triage-auth.mjs';
const session=id=>({user:{id}});

test('initial identity, same-user sign-in and token refresh preserve an active query',()=>{
 let clears=0;const change=createTriageAuthGuard(()=>clears++);
 change('INITIAL_SESSION',session('a'));
 change('SIGNED_IN',session('a'));change('TOKEN_REFRESHED',session('a'));change('SIGNED_IN',session('a'));
 assert.equal(clears,0);
});
test('first sign-in can establish identity before INITIAL_SESSION arrives',()=>{
 let clears=0;const change=createTriageAuthGuard(()=>clears++);
 change('SIGNED_IN',session('a'));change('INITIAL_SESSION',session('a'));
 assert.equal(clears,0);
});
test('account change and sign-out invalidate queries; same-user refresh never undoes it',()=>{
 let clears=0;const change=createTriageAuthGuard(()=>clears++);
 change('INITIAL_SESSION',session('a'));change('SIGNED_IN',session('b'));assert.equal(clears,1);
 change('SIGNED_OUT',null);assert.equal(clears,2);
 change('SIGNED_IN',session('b'));assert.equal(clears,3);
 change('TOKEN_REFRESHED',session('b'));assert.equal(clears,3);
});
test('user update, password recovery and invalid sign-in always invalidate',()=>{
 let clears=0;const change=createTriageAuthGuard(()=>clears++);
 change('INITIAL_SESSION',session('a'));
 change('USER_UPDATED',session('a'));change('PASSWORD_RECOVERY',session('a'));change('SIGNED_IN',null);
 assert.equal(clears,3);
});
