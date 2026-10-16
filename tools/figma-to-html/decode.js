const fs=require('fs'),kiwi=require('kiwi-schema'),fzstd=require('fzstd'),pako=require('pako');
const [,,inp,out]=process.argv;
const buf=fs.readFileSync(inp);let off=12;const chunks=[];
while(off<buf.length){const n=buf.readUInt32LE(off);off+=4;chunks.push(buf.subarray(off,off+n));off+=n;}
function dec(c){if(c[0]==0x28&&c[1]==0xb5)return fzstd.decompress(c);return pako.inflateRaw(c);}
const schema=kiwi.compileSchema(kiwi.decodeBinarySchema(dec(chunks[0])));
const msg=schema.decodeMessage(dec(chunks[1]));
fs.writeFileSync(out,JSON.stringify(msg,(k,v)=>typeof v==='bigint'?Number(v):(v instanceof Uint8Array?('b64:'+Buffer.from(v).toString('base64')):v)));
console.log(msg.nodeChanges.length);
