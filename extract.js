/* Receipt field extraction. Kept separate from OCR so parsing can be regression-tested. */
(function(root){
function parseReceipt(text){
 const lines=text.replace(/\u00a0/g,' ').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
 const out={vendor:'',amount:'',currency:'INR',date:'',time:'',transactionId:'',invoiceNumber:'',category:'Other',method:'Unknown'};
 // Explicit currency codes beat isolated symbols, which OCR often invents in photos.
 const codes=text.match(/\b(INR|USD|EUR|GBP|AED|SGD|CAD|AUD)\b/gi);
 if(codes?.length){const counts={};codes.forEach(c=>{c=c.toUpperCase();counts[c]=(counts[c]||0)+1});out.currency=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]}
 else if(/\bRs\.?\s*\d|₹\s*\d/i.test(text))out.currency='INR';
 else if(/(?:US\s*\$|\$)\s*\d/.test(text))out.currency='USD';
 else if(/€\s*\d/.test(text))out.currency='EUR';
 else if(/£\s*\d/.test(text))out.currency='GBP';
 const candidates=[];
 const values=line=>[...line.matchAll(/(?<![\d.])((?:\d{1,3}(?:,\d{2,3})+|\d+)\s*\.\s*\d{2})(?!\d)/g)].map(m=>Number(m[1].replace(/[,\s]/g,''))).filter(n=>n>0&&n<1e10);
 lines.forEach((line,i)=>{
  if(/\b(?:subtotal|sub\s+total|savings?|discount|change|balance|cash\s+tendered|taxable|CGST|SGST|CESS|GSTIN|tax\s+amount|rate)\b|\d\s*%/i.test(line))return;
  let rank=/grand\s*total|net\s*(?:amount|payable|total)|amount\s*(?:paid|payable|due|debited)|total\s*(?:amount|paid|due)|you\s*paid/i.test(line)?100:
   /\b(?:card|upi|cash|wallet)\s*(?:pay(?:ment)?|paid)|\bamount\s*[:=]/i.test(line)?95:
   /\bitems?\s*:\s*\d.*\bqty\s*:/i.test(line)?90:
   /\btotal\b/i.test(line)?85:/(?:₹|Rs\.?|\bINR|\bUSD|\$|€|£)\s*\d/i.test(line)?65:0;
  if(!rank)return;
  let nums=values(line);
  if(!nums.length){const m=line.match(/(?:₹|Rs\.?|INR|USD|EUR|GBP|AED|SGD|CAD|AUD|\$|€|£)\s*([\d,]+)(?![\d.])/i)||line.match(/(?:total|amount\s*(?:paid|due|payable)?)\s*[:=]?\s*([\d,]+)\s*$/i);if(m)nums=[Number(m[1].replace(/,/g,''))]}
  if(nums.length)candidates.push({value:nums.at(-1),rank,index:i});
  else if(rank>=85&&lines[i+1]&&/^(?:[₹$€£]|Rs\.?|INR|USD)?\s*[\d,.]+\s*(?:\/-)?$/i.test(lines[i+1])){const next=values(lines[i+1]);if(next.length)candidates.push({value:next.at(-1),rank:rank-5,index:i})}
 });
 candidates.forEach(c=>{c.score=c.rank+Math.min(12,4*(candidates.filter(x=>x.value===c.value).length-1))});
 candidates.sort((a,b)=>b.score-a.score||b.index-a.index);
 if(candidates[0]?.value>0)out.amount=candidates[0].value;
 const clean=l=>l.replace(/^[^a-z0-9]+|[^a-z0-9)]+$/gi,'').trim();
 for(let i=0;i<lines.length;i++){const m=lines[i].match(/^(?:paid\s+to|payment\s+to|merchant|vendor|payee|recipient|billed\s+by)\s*:?\s*(.*)$/i);if(m){out.vendor=clean(m[1]||lines[i+1]||'');break}}
 if(!out.vendor)out.vendor=clean(lines.find(l=>/[a-z]{3}/i.test(l)&&l.length<75&&!/receipt|invoice|transaction|payment|successful|success|phonepe|google pay|paytm|upi|bank|\bpaid\b|\btotal\b|\bdate\b|\btime\b|\bamount\b|\bref\b|thank|welcome|computer|genrated|generated|particulars|GSTIN|CIN\s*No|FSSAI|\d{4,}/i.test(l))||'');
 // Use payment references for Transaction ID; keep invoice numbers separate.
 for(const rx of [/(?:UPI\s*)?(?:transaction|txn)\s*(?:id|no\.?|number)?\s*[:#=\-]?\s*([a-z0-9][a-z0-9\-/]{5,})/gi,/\b(?:UTR|RRN)\s*[:#=+\-]?\s*([a-z0-9][a-z0-9\-/]{5,})/gi,/\b(?:reference|ref)\s*(?:id|no\.?|number)?\s*[:#=\-]?\s*([a-z0-9][a-z0-9\-/]{5,})/gi]){const matches=[...text.matchAll(rx)];if(matches.length){out.transactionId=matches.at(-1)[1];break}}
 const invoices=[...text.matchAll(/\b(?:invoice|inv|bill)\s*(?:id|no\.?|number)\s*[:#=\-]?\s*([a-z0-9][a-z0-9\-/]{3,})/gi)];if(invoices.length)out.invoiceNumber=invoices.at(-1)[1];
 function validDate(y,m,d){y=Number(y);if(y<100)y+=2000;const v=new Date(Date.UTC(y,Number(m)-1,Number(d)));return v.getUTCFullYear()===y&&v.getUTCMonth()===Number(m)-1&&v.getUTCDate()===Number(d)?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:''}
 const dateLines=[...lines.filter(l=>/date|bill\s*d[tl]|\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}T/i.test(l)),...lines];
 for(const l of dateLines){let d=l.match(/\b(20\d{2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})(?=T|\b)/i);if(d)out.date=validDate(d[1],d[2],d[3]);if(!out.date){d=l.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/);if(d)out.date=validDate(d[3],d[2],d[1])}if(!out.date){const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];d=l.match(/\b(\d{1,2})\s*[-\s/]\s*(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s*[,\-\s/]\s*(20\d{2})\b/i);if(d)out.date=validDate(d[3],months.indexOf(d[2].slice(0,3).toLowerCase())+1,d[1]);else{d=l.match(/\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+(\d{1,2}),?\s+(20\d{2})/i);if(d)out.date=validDate(d[3],months.indexOf(d[1].slice(0,3).toLowerCase())+1,d[2])}}if(out.date)break}
 for(const l of dateLines){const times=[...l.matchAll(/(?<!\d)(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*\d{2})?\s*(am|pm)?\b/gi)];for(const t of times){let h=Number(t[1]),m=Number(t[2]);if(t[3]){if(h<1||h>12)continue;h=h%12+(/pm/i.test(t[3])?12:0)}if(h>23||m>59)continue;out.time=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');break}if(out.time)break}
 if(/\bupi\b|phonepe|google pay|gpay|paytm/i.test(text))out.method='UPI';else if(/\bcard\b|visa|mastercard/i.test(text))out.method='Card';else if(/\bcash\b/i.test(text))out.method='Cash';else if(/bank transfer|neft|rtgs|imps/i.test(text))out.method='Bank transfer';
 const v=out.vendor.toLowerCase();if(/cafe|coffee|brew|restaurant|food|swiggy|zomato|bakery|pizza/.test(v))out.category='Food & drinks';else if(/uber|ola|rail|airline|flight|metro|fuel|petrol/.test(v))out.category='Travel';else if(/electric|broadband|telecom|water|internet|airtel|jio/.test(v))out.category='Bills & utilities';else if(/pharma|hospital|clinic|medical/.test(v))out.category='Health';else if(/amazon|flipkart|store|mart|shop/.test(v))out.category='Shopping';return out;
}
root.parseReceipt=parseReceipt;if(typeof module!=='undefined')module.exports={parseReceipt};
})(typeof window==='undefined'?globalThis:window);
