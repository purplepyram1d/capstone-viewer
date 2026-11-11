const {app,safeStorage}=require('electron');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const testProfile=path.resolve('runtime','vault-test-profile');fs.mkdirSync(testProfile,{recursive:true});app.setPath('userData',testProfile);
app.whenReady().then(async()=>{
  assert.equal(await safeStorage.isAsyncEncryptionAvailable(),true);
  const value='capstone-test-fixture-not-a-real-token',encrypted=await safeStorage.encryptStringAsync(value);
  assert.equal(encrypted.includes(Buffer.from(value)),false);assert.equal((await safeStorage.decryptStringAsync(encrypted)).result,value);
  fs.writeFileSync(path.resolve('runtime','vault-test-result.json'),JSON.stringify({passed:true,encryptionAvailable:true,plaintextAbsent:true,roundTripPassed:true}));
  console.log('Windows credential encryption round-trip passed. No real credential was read or written.');app.quit();
}).catch(error=>{fs.writeFileSync(path.resolve('runtime','vault-test-result.json'),JSON.stringify({passed:false,error:error.message}));console.error(error.message);app.exit(1);});
