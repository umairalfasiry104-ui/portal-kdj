import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: false });
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { renderFinancialDocumentPdf } from '../lib/financial-document-pdf.mjs';

const logoBuffer = await readFile(new URL('../public/kdj-logo.png', import.meta.url));
// Use a generic image as a test-only stand-in; the real issuer signature stays in a server secret.
const testSignatureBuffer = logoBuffer;

const issuer = {
    display_name: 'KULIAH DI JORDAN',
    legal_name: 'Yayasan Contoh KDJ',
    address: 'Jl. Contoh Raya No. 1, Depok',
    phone: '080000000000',
    instagram: '@contoh',
    email: 'admin@example.test',
    bank_account_holder: 'YAYASAN CONTOH KDJ',
    bank_name: 'BANK CONTOH',
    bank_account_number: '0000000000',
    payment_warning: 'CONTOH SAJA - GUNAKAN REKENING RESMI YANG TERCANTUM',
    signatory_name: 'Nama Penandatangan'
};

const invoice = {
    document_type: 'INVOICE',
    document_number: 'INV-TEST-2026-0001',
    amount_idr: 29900000,
    issued_at: '2026-11-19T00:00:00+07:00',
    due_at: '2026-12-19T23:59:59+07:00',
    document_snapshot: {
        issuer,
        customer: {
            name: 'Mahasiswa Contoh KDJ',
            whatsapp: '080000000000'
        },
        line_items: [{
            description: 'Pembayaran Paket KDJ : SIAP KULIAH +',
            amount_idr: 29900000
        }],
        notes: [
            'Sistem Pembayaran',
            'Pembayaran lunas dilakukan mengikuti tanggal jatuh tempo pada invoice yang diterbitkan.',
            'Pembayaran bertahap mengikuti jadwal dan nominal pada invoice terbaru.',
            'Nilai paket mengikuti ketentuan resmi KDJ.',
            'Kebijakan pengembalian mengikuti ketentuan resmi KDJ.'
        ]
    }
};

const receipt = {
    document_type: 'RECEIPT',
    document_number: 'KWT-TEST-2026-0001',
    amount_idr: 1500000,
    issued_at: '2026-11-20T00:00:00+07:00',
    paid_at: '2026-11-19T00:00:00+07:00',
    document_snapshot: {
        issuer,
        customer: {
            name: 'Mahasiswa Contoh KDJ',
            whatsapp: '080000000000'
        },
        payment_entries: [{
            description: 'Pembayaran 1',
            amount_idr: 1500000,
            paid_at: '2026-11-19T00:00:00+07:00',
            method: 'Transfer via BANK CONTOH',
            status: 'Lunas'
        }],
        package_items: [{
            quantity: 1,
            description: 'Paket KDJ : SIAP KULIAH +',
            amount_idr: 29900000
        }],
        package_total_amount_idr: 29900000,
        total_paid_amount_idr: 1500000,
        remaining_amount_idr: 28400000,
        notes: [
            'Sistem Pembayaran',
            'Pembayaran lunas dilakukan mengikuti tanggal jatuh tempo pada invoice yang diterbitkan.',
            'Pembayaran bertahap mengikuti jadwal dan nominal pada invoice terbaru.',
            'Nilai paket mengikuti ketentuan resmi KDJ.',
            'Kebijakan pengembalian mengikuti ketentuan resmi KDJ.'
        ]
    }
};

function assertPdf(buffer, documentNumber) {
    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.subarray(0, 5).equals(Buffer.from('%PDF-')), 'PDF header must be present.');
    assert.ok(buffer.length > 5000, 'PDF should contain the rendered document and logo.');
    assert.ok(buffer.subarray(-1024).includes(Buffer.from('%%EOF')), 'PDF end marker must be present.');
    const imageObjects = buffer.toString('latin1').match(/\/Subtype\s*\/Image\b/g) || [];
    assert.ok(imageObjects.length >= 2, 'The logo and an explicitly supplied test image must both be embedded.');
    assert.ok(buffer.includes(Buffer.from(documentNumber)), 'Document number should be present in PDF metadata.');
    const pageObjects = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || [];
    assert.equal(pageObjects.length, 1, 'The supplied example layout should fit on one A4 page.');
}

const invoicePdf = await renderFinancialDocumentPdf(invoice, { logoBuffer, signatureBuffer: testSignatureBuffer });
const receiptPdf = await renderFinancialDocumentPdf(receipt, { logoBuffer, signatureBuffer: testSignatureBuffer });

let privateSignaturePdf = null;
if (process.env.KDJ_ISSUER_SIGNATURE_BASE64) {
    privateSignaturePdf = await renderFinancialDocumentPdf(invoice, { logoBuffer });
    const embeddedImages = privateSignaturePdf.toString('latin1').match(/\/Subtype\s*\/Image\b/g) || [];
    assert.ok(embeddedImages.length >= 2, 'The server-only issuer signature must be embedded when the secret is configured.');
    assert.ok(privateSignaturePdf.subarray(0, 5).equals(Buffer.from('%PDF-')));
    console.log('[PASS] The server-only issuer signature secret is valid and embedded.');
}

assertPdf(invoicePdf, 'INV-TEST-2026-0001');
assertPdf(receiptPdf, 'KWT-TEST-2026-0001');

if (process.env.KDJ_ISSUER_SIGNATURE_BASE64) {
    const actualLogoBuffer = await readFile(new URL('../public/kdj-logo.png', import.meta.url));
    const actualSignatureBuffer = Buffer.from(process.env.KDJ_ISSUER_SIGNATURE_BASE64, 'base64');
    const actualLogoHash = createHash('sha256').update(actualLogoBuffer).digest('hex');
    const actualSignatureHash = createHash('sha256').update(actualSignatureBuffer).digest('hex');
    assert.equal(actualLogoHash, 'f767d1b60983722435769d59654b8693a4dbe4524f52249486e99bacbad15b6b');
    assert.equal(actualSignatureHash, '82b765625730ec6ab70e9bc0f093ad1c40c3d0d4f643074e22596c9e07ba4c51');
    const issuerWithImmutableAssets = {
        ...issuer,
        logo_sha256: actualLogoHash,
        signature_sha256: actualSignatureHash
    };
    const signedInvoice = {
        ...invoice,
        document_snapshot: {
            ...invoice.document_snapshot,
            issuer: issuerWithImmutableAssets
        }
    };
    const signedPdf = await renderFinancialDocumentPdf(signedInvoice);
    assertPdf(signedPdf, 'INV-TEST-2026-0001');
    console.log('[PASS] Local-only issuer signature and logo hashes match the immutable issuer snapshot.');
}

await assert.rejects(
    () => renderFinancialDocumentPdf({ ...invoice, document_type: 'INVALID' }, { logoBuffer, signatureBuffer: testSignatureBuffer }),
    /must be INVOICE or RECEIPT/
);
await assert.rejects(
    () => renderFinancialDocumentPdf({ ...invoice, amount_idr: 0 }, { logoBuffer, signatureBuffer: testSignatureBuffer }),
    /positive integer/
);
await assert.rejects(
    () => renderFinancialDocumentPdf({
        ...invoice,
        document_snapshot: { ...invoice.document_snapshot, issuer: { ...issuer, bank_account_number: '' } }
    }, { logoBuffer, signatureBuffer: testSignatureBuffer }),
    /bank_account_number/
);
await assert.rejects(
    () => renderFinancialDocumentPdf(invoice, { logoBuffer: Buffer.from('not-an-image') }),
    /PNG or JPEG/
);

console.log('[PASS] Invoice example renders to a valid A4 PDF with KDJ branding and immutable snapshot data.');
console.log('[PASS] Receipt example renders payment rows, package totals, paid subtotal, and remaining balance.');
console.log('[PASS] The logo and a generic test image are embedded in both PDF types.');
console.log('[PASS] Document type, amount, issuer metadata, and image assets are validated before rendering.');

if (process.env.KDJ_PDFKIT_PREVIEW_DIR) {
    await mkdir(process.env.KDJ_PDFKIT_PREVIEW_DIR, { recursive: true });
    await writeFile(new URL('invoice-sample.pdf', 'file:///' + process.env.KDJ_PDFKIT_PREVIEW_DIR.replace(/\\/g, '/') + '/'), invoicePdf);
    await writeFile(new URL('receipt-sample.pdf', 'file:///' + process.env.KDJ_PDFKIT_PREVIEW_DIR.replace(/\\/g, '/') + '/'), receiptPdf);
    if (privateSignaturePdf) {
        await writeFile(new URL('invoice-with-private-signature.pdf', 'file:///' + process.env.KDJ_PDFKIT_PREVIEW_DIR.replace(/\\/g, '/') + '/'), privateSignaturePdf);
    }
}
