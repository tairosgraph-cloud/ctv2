import puppeteer from 'puppeteer';
import path from 'path';

async function makePdf() {
  const htmlPath = path.resolve(process.cwd(), 'report.html');
  const url = 'file://' + htmlPath;
  const out = path.resolve(process.cwd(), 'report.pdf');
  console.log('Rendering', url, '->', out);
  const browser = await puppeteer.launch({args: ['--no-sandbox','--disable-setuid-sandbox']});
  try {
    const page = await browser.newPage();
    await page.goto(url, {waitUntil: 'networkidle0'});
    await page.pdf({path: out, format: 'A4', printBackground: true, margin: {top: '20mm', bottom: '20mm', left: '15mm', right: '15mm'}});
    console.log('PDF generado en', out);
  } finally {
    await browser.close();
  }
}

makePdf().catch(err => {
  console.error(err);
  process.exit(1);
});