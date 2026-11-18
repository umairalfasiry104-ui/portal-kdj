import { PDFDocument } from 'pdfkit';

const PAGE = Object.freeze({
    width: 595.28,
    height: 841.89,
    margin: 34,
    footerTop: 34
});

const COLORS = Object.freeze({
    green: '#3B7A29',
    greenDark: '#2F6822',
    greenPale: '#DFF0D8',
    greenPaler: '#F3F8F0',
    ink: '#171717',
    muted: '#555555',
    line: '#202020',
    yellow: '#F7E7AD',
    red: '#C40000',
    white: '#FFFFFF'
});

const TABLE_WIDTH = PAGE.width - PAGE.margin * 2;

function cleanText(value, maxLength = 2000) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function positiveAmount(value, fieldName, allowZero = false) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1)) {
        throw new TypeError(fieldName + ' must be a ' +
            (allowZero ? 'non-negative' : 'positive') + ' integer in IDR.');
    }
    return amount;
}

function formatAmount(value) {
    return new Intl.NumberFormat('id-ID', {
        maximumFractionDigits: 0
    }).format(positiveAmount(value, 'Amount', true));
}

function parseDate(value, fieldName) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
        throw new TypeError(fieldName + ' must be a valid date.');
    }
    return date;
}

function formatDateLong(value) {
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    }).format(parseDate(value, 'Date'));
}

function formatDateShort(value) {
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
    }).format(parseDate(value, 'Date'));
}

function assertImageBuffer(buffer, name) {
    if (buffer === undefined || buffer === null) return null;
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
        throw new TypeError(name + ' must be a Buffer or Uint8Array.');
    }
    const bytes = Buffer.from(buffer);
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isPng && !isJpeg) throw new TypeError(name + ' must be a PNG or JPEG image.');
    return bytes;
}

function drawCell(doc, x, y, width, height, {
    fill = null,
    stroke = COLORS.line,
    lineWidth = 0.6
} = {}) {
    if (fill) doc.rect(x, y, width, height).fill(fill);
    if (stroke) doc.rect(x, y, width, height).lineWidth(lineWidth).stroke(stroke);
}

function drawText(doc, text, x, y, width, {
    font = 'Helvetica',
    size = 8,
    color = COLORS.ink,
    align = 'left',
    valign = 'top',
    lineGap = 1,
    height = undefined
} = {}) {
    const value = cleanText(text, 4000);
    if (!value) return 0;
    doc.font(font).fontSize(size).fillColor(color);
    const measured = doc.heightOfString(value, { width, lineGap });
    const boxHeight = height ?? measured;
    let textY = y;
    if (valign === 'middle') textY += Math.max(0, (boxHeight - measured) / 2);
    if (valign === 'bottom') textY += Math.max(0, boxHeight - measured);
    doc.text(value, x, textY, { width, align, lineGap, height: height ?? undefined });
    return measured;
}

function drawBrandHeader(doc, record, issuer, logoBuffer, continuation = false) {
    const x = PAGE.margin;
    const top = 28;
    const logoWidth = 118;
    const logoHeight = 48;

    if (logoBuffer) {
        doc.image(logoBuffer, x, top, { fit: [logoWidth, logoHeight] });
    } else {
        doc.font('Helvetica-Bold').fontSize(23).fillColor(COLORS.green).text('KDJ', x, top + 8);
    }

    const textX = x + logoWidth + 12;
    const textWidth = PAGE.width - PAGE.margin - textX;
    drawText(doc, issuer.display_name, textX, top + 1, textWidth, {
        font: 'Helvetica-Bold', size: 11, color: COLORS.ink
    });
    drawText(doc, issuer.legal_name, textX, top + 15, textWidth, {
        size: 8.5, color: COLORS.ink
    });
    drawText(doc, issuer.address, textX, top + 27, textWidth, {
        size: 7, color: COLORS.muted
    });
    const contacts = [issuer.phone, issuer.instagram, issuer.email].filter(Boolean).join(' | ');
    if (contacts) {
        drawText(doc, contacts, textX, top + 38, textWidth, {
            size: 6.8, color: COLORS.muted
        });
    }

    const ruleY = top + logoHeight + 7;
    doc.moveTo(x, ruleY).lineTo(PAGE.width - PAGE.margin, ruleY).lineWidth(1).stroke(COLORS.green);
    const title = record.document_type === 'INVOICE' ? 'INVOICE' : 'KWITANSI';
    drawText(doc, continuation ? title + ' (LANJUTAN)' : title,
        x, ruleY + 8, TABLE_WIDTH, {
            font: 'Helvetica-Bold', size: 15, align: 'center', color: COLORS.ink
        });

    return ruleY + 34;
}

function drawDocumentMeta(doc, record, snapshot, y) {
    const half = TABLE_WIDTH / 2;
    drawText(doc, 'Faktur : ' + cleanText(record.document_number, 80), PAGE.margin, y, half, {
        size: 8.5
    });
    drawText(doc, 'Tanggal : ' + formatDateLong(record.issued_at),
        PAGE.margin + half, y, half, { size: 8.5 });
    y += 32;

    drawText(doc, 'Nama Mahasiswa/i', PAGE.margin, y, 102, { size: 8.5 });
    drawText(doc, ':', PAGE.margin + 102, y, 8, { size: 8.5 });
    drawText(doc, snapshot.customer.name, PAGE.margin + 114, y, TABLE_WIDTH - 114, {
        font: 'Helvetica-Bold', size: 9
    });
    return y + 27;
}

function drawTableHeader(doc, x, y, widths, labels, height = 22) {
    let currentX = x;
    labels.forEach((label, index) => {
        drawCell(doc, currentX, y, widths[index], height, {
            fill: COLORS.green,
            stroke: COLORS.line,
            lineWidth: 0.7
        });
        drawText(doc, label, currentX + 4, y + 6, widths[index] - 8, {
            font: 'Helvetica-Bold',
            size: 7.5,
            color: COLORS.white,
            align: index === labels.length - 1 ? 'right' : 'center',
            valign: 'middle',
            height: height - 4
        });
        currentX += widths[index];
    });
    return y + height;
}

function drawTableRow(doc, x, y, widths, values, {
    height = 24,
    fill = COLORS.greenPale,
    font = 'Helvetica',
    size = 8,
    alignments = [],
    boldColumns = []
} = {}) {
    let currentX = x;
    values.forEach((value, index) => {
        drawCell(doc, currentX, y, widths[index], height, {
            fill,
            stroke: COLORS.line,
            lineWidth: 0.6
        });
        const isBold = boldColumns.includes(index);
        drawText(doc, value, currentX + 5, y + 5, widths[index] - 10, {
            font: isBold ? 'Helvetica-Bold' : font,
            size,
            align: alignments[index] || (index === values.length - 1 ? 'right' : 'left'),
            valign: 'middle',
            height: height - 8
        });
        currentX += widths[index];
    });
    return y + height;
}

function drawTotalsRow(doc, x, y, label, amount, {
    labelWidth = TABLE_WIDTH - 112,
    fill = COLORS.greenPale,
    height = 24,
    bold = true
} = {}) {
    drawCell(doc, x, y, labelWidth, height, {
        fill,
        stroke: COLORS.line,
        lineWidth: 0.6
    });
    drawCell(doc, x + labelWidth, y, TABLE_WIDTH - labelWidth, height, {
        fill,
        stroke: COLORS.line,
        lineWidth: 0.6
    });
    drawText(doc, label, x + 5, y + 6, labelWidth - 10, {
        font: bold ? 'Helvetica-Bold' : 'Helvetica',
        size: 8,
        align: 'right',
        valign: 'middle',
        height: height - 8
    });
    drawText(doc, formatAmount(amount), x + labelWidth + 5, y + 6,
        TABLE_WIDTH - labelWidth - 10, {
            font: 'Helvetica-Bold',
            size: 8,
            align: 'right',
            valign: 'middle',
            height: height - 8
        });
    return y + height;
}

function drawBankBox(doc, issuer, x, y, width) {
    const headerHeight = 18;
    const contentHeight = 62;
    const warningHeight = 23;
    const totalHeight = headerHeight + contentHeight + warningHeight;

    drawCell(doc, x, y, width, headerHeight, {
        fill: COLORS.green,
        stroke: COLORS.line
    });
    drawText(doc, 'Catatan', x + 5, y + 4, width - 10, {
        font: 'Helvetica-Bold', size: 8, color: COLORS.white, align: 'center'
    });

    drawCell(doc, x, y + headerHeight, width, contentHeight, {
        fill: COLORS.white,
        stroke: COLORS.line
    });
    drawText(doc, cleanText(issuer.transfer_label || 'Transfer via Rekening Bank', 100),
        x + 8, y + 34, width - 16, { size: 8, align: 'center' });
    drawText(doc, issuer.bank_account_holder, x + 8, y + 49, width - 16, {
        font: 'Helvetica-Bold', size: 8.5, align: 'center'
    });
    const bankText = [issuer.bank_name, issuer.bank_account_number].filter(Boolean).join(' ');
    drawText(doc, bankText, x + 8, y + 67, width - 16, {
        font: 'Helvetica-Bold', size: 11, align: 'center'
    });

    drawCell(doc, x, y + headerHeight + contentHeight, width, warningHeight, {
        fill: COLORS.red,
        stroke: COLORS.line
    });
    drawText(doc, issuer.payment_warning, x + 5, y + headerHeight + contentHeight + 6, width - 10, {
        font: 'Helvetica-Bold',
        size: 6.2,
        color: COLORS.white,
        align: 'center',
        valign: 'middle',
        height: warningHeight - 8
    });

    return y + totalHeight;
}

function drawSignatory(doc, issuer, signatureBuffer, x, y, width) {
    drawText(doc, 'Hormat Kami', x, y, width, { size: 8, align: 'center' });
    let nameY = y + 54;
    if (signatureBuffer) {
        doc.image(signatureBuffer, x + (width - 88) / 2, y + 12, {
            fit: [88, 34],
            align: 'center',
            valign: 'center'
        });
        nameY = y + 54;
    } else {
        doc.moveTo(x + 20, y + 45).lineTo(x + width - 20, y + 45)
            .lineWidth(0.5).stroke('#777777');
    }
    drawText(doc, issuer.signatory_name, x, nameY, width, {
        size: 8, align: 'center'
    });
    return nameY + 14;
}

function drawNotes(doc, notes, x, y, width, safeBottom) {
    const entries = Array.isArray(notes)
        ? notes.map((item) => cleanText(item, 1200)).filter(Boolean)
        : (cleanText(notes, 5000) ? [cleanText(notes, 5000)] : []);
    if (entries.length === 0) return y;

    drawText(doc, 'Catatan :', x, y, width, {
        font: 'Helvetica-Bold', size: 8.5
    });
    y += 15;

    entries.forEach((entry, index) => {
        const prefix = entries.length > 1 ? String(index + 1) + '. ' : '';
        const value = prefix + entry;
        const height = doc.font('Helvetica').fontSize(7.2)
            .heightOfString(value, { width, lineGap: 2 });
        if (y + height > safeBottom) {
            doc.addPage({ size: 'A4', margin: 0 });
            drawText(doc, 'Catatan (lanjutan)', x, 42, width, {
                font: 'Helvetica-Bold', size: 8.5
            });
            y = 58;
        }
        drawText(doc, value, x, y, width, {
            size: 7.2, lineGap: 2
        });
        y += height + 5;
    });
    return y;
}

function validateDocumentRecord(record) {
    if (!record || !['INVOICE', 'RECEIPT'].includes(record.document_type)) {
        throw new TypeError('Financial document type must be INVOICE or RECEIPT.');
    }
    if (!cleanText(record.document_number, 80)) {
        throw new TypeError('Financial document number is required.');
    }
    parseDate(record.issued_at, 'Issue date');
    positiveAmount(record.amount_idr, 'Document amount');

    const snapshot = record.document_snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new TypeError('Financial document snapshot is required.');
    }
    const issuer = snapshot.issuer;
    const customer = snapshot.customer;
    if (!issuer || !customer || !cleanText(customer.name, 150)) {
        throw new TypeError('Issuer and student snapshots are required.');
    }
    const requiredIssuerFields = [
        'display_name', 'legal_name', 'address', 'bank_account_holder',
        'bank_name', 'bank_account_number', 'payment_warning'
    ];
    for (const field of requiredIssuerFields) {
        if (!cleanText(issuer[field], 240)) {
            throw new TypeError('Issuer snapshot field "' + field + '" is required.');
        }
    }

    if (record.document_type === 'INVOICE') {
        if (!Array.isArray(snapshot.line_items) || snapshot.line_items.length === 0) {
            throw new TypeError('Invoice must contain at least one line item.');
        }
        if (snapshot.line_items.length > 12) {
            throw new TypeError('Invoice supports at most 12 line items per generated PDF.');
        }
        for (const [index, item] of snapshot.line_items.entries()) {
            if (!cleanText(item?.description, 180)) {
                throw new TypeError('Invoice line item ' + (index + 1) + ' needs a description.');
            }
            positiveAmount(item.amount_idr ?? item.total_amount_idr, 'Invoice line item ' + (index + 1) + ' amount');
        }
    } else {
        if (!Array.isArray(snapshot.payment_entries) || snapshot.payment_entries.length === 0) {
            throw new TypeError('Receipt must contain at least one confirmed payment entry.');
        }
        if (snapshot.payment_entries.length > 6) {
            throw new TypeError('Receipt supports at most 6 payment entries per generated PDF.');
        }
        if (Array.isArray(snapshot.package_items) && snapshot.package_items.length > 5) {
            throw new TypeError('Receipt supports at most 5 package items per generated PDF.');
        }
        for (const [index, payment] of snapshot.payment_entries.entries()) {
            if (!cleanText(payment?.description || payment?.label, 100)) {
                throw new TypeError('Receipt payment entry ' + (index + 1) + ' needs a description.');
            }
            positiveAmount(payment.amount_idr, 'Receipt payment entry ' + (index + 1) + ' amount');
            parseDate(payment.paid_at, 'Receipt payment entry ' + (index + 1) + ' date');
            if (!cleanText(payment.method, 80) || !cleanText(payment.status, 40)) {
                throw new TypeError('Receipt payment entry ' + (index + 1) + ' needs method and status.');
            }
        }
    }
    return { snapshot, issuer };
}

/**
 * Render an immutable invoice/receipt snapshot to an A4 PDF.
 * Logo/signature assets are supplied as binary data; no arbitrary filesystem path is accepted.
 */
export async function renderFinancialDocumentPdf(record, assets = {}) {
    const { snapshot, issuer } = validateDocumentRecord(record);
    const logoBuffer = assertImageBuffer(assets.logoBuffer, 'Logo asset');
    const signatureBuffer = assertImageBuffer(assets.signatureBuffer, 'Signature asset');
    const issuedAt = parseDate(record.issued_at, 'Issue date');
    const title = record.document_type === 'INVOICE' ? 'Invoice KDJ' : 'Kwitansi KDJ';

    const pdf = new PDFDocument({
        size: 'A4',
        margin: 0,
        bufferPages: true,
        compress: true,
        info: {
            Title: cleanText(record.document_number, 80),
            Author: cleanText(issuer.display_name, 120),
            Subject: title,
            Creator: 'KDJ Portal',
            Producer: 'KDJ Portal / PDFKit',
            CreationDate: issuedAt,
            ModDate: issuedAt
        }
    });

    const chunks = [];
    const result = new Promise((resolve, reject) => {
        pdf.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        pdf.once('end', () => resolve(Buffer.concat(chunks)));
        pdf.once('error', reject);
    });

    let y = drawBrandHeader(pdf, record, issuer, logoBuffer);
    y = drawDocumentMeta(pdf, record, snapshot, y);

    if (record.document_type === 'INVOICE') {
        y = drawTableHeader(pdf, PAGE.margin, y, [TABLE_WIDTH - 112, 112], ['Deskripsi', 'Jumlah']);
        for (const item of snapshot.line_items) {
            const description = cleanText(item.description, 180);
            const height = Math.max(24, pdf.font('Helvetica').fontSize(8)
                .heightOfString(description, { width: TABLE_WIDTH - 122 }) + 10);
            y = drawTableRow(pdf, PAGE.margin, y, [TABLE_WIDTH - 112, 112], [
                description,
                formatAmount(item.amount_idr ?? item.total_amount_idr)
            ], { height, fill: COLORS.greenPale, size: 8 });
        }
        y = drawTotalsRow(pdf, PAGE.margin, y, 'Total Pembayaran', record.amount_idr, {
            labelWidth: TABLE_WIDTH - 112,
            fill: COLORS.greenPale,
            height: 25
        });
        if (record.due_at || snapshot.due_at) {
            y += 17;
            drawText(pdf, 'Jatuh tempo : ' + formatDateLong(record.due_at || snapshot.due_at),
                PAGE.margin, y, TABLE_WIDTH, { font: 'Helvetica-Bold', size: 8 });
            y += 13;
        }
    } else {
        const paymentWidths = [96, 82, 76, 130, TABLE_WIDTH - 384];
        y = drawTableHeader(pdf, PAGE.margin, y, paymentWidths,
            ['Pembayaran', 'Jumlah', 'Tanggal', 'Metode Pembayaran', 'Status Pembayaran']);
        let paymentSubtotal = 0;
        for (const payment of snapshot.payment_entries) {
            const amount = positiveAmount(payment.amount_idr, 'Payment amount');
            paymentSubtotal += amount;
            y = drawTableRow(pdf, PAGE.margin, y, paymentWidths, [
                payment.description || payment.label,
                formatAmount(amount),
                formatDateShort(payment.paid_at),
                payment.method,
                payment.status
            ], { height: 26, fill: COLORS.greenPale, size: 6.8 });
        }
        y = drawTotalsRow(pdf, PAGE.margin, y, 'Sub Total', paymentSubtotal, {
            labelWidth: paymentWidths[0],
            fill: COLORS.yellow,
            height: 22
        });

        y += 18;
        const packageItems = Array.isArray(snapshot.package_items) ? snapshot.package_items : [];
        if (packageItems.length > 0) {
            const packageWidths = [48, TABLE_WIDTH - 160, 112];
            y = drawTableHeader(pdf, PAGE.margin, y, packageWidths, ['Pax', 'Deskripsi', 'Jumlah']);
            for (const item of packageItems) {
                y = drawTableRow(pdf, PAGE.margin, y, packageWidths, [
                    String(Math.max(1, Number(item.quantity) || 1)),
                    item.description,
                    formatAmount(item.amount_idr ?? item.total_amount_idr)
                ], { height: 26, fill: COLORS.greenPale, size: 7.5 });
            }
        }

        const packageTotal = positiveAmount(
            snapshot.package_total_amount_idr ?? snapshot.total_amount_idr ?? record.amount_idr,
            'Package total',
            true
        );
        const totalPaid = positiveAmount(
            snapshot.total_paid_amount_idr ?? snapshot.total_paid_idr ?? paymentSubtotal,
            'Total paid',
            true
        );
        const remaining = positiveAmount(
            snapshot.remaining_amount_idr ?? Math.max(0, packageTotal - totalPaid),
            'Remaining amount',
            true
        );

        y = drawTotalsRow(pdf, PAGE.margin, y, 'Total Pembayaran', packageTotal, {
            labelWidth: TABLE_WIDTH - 112,
            fill: COLORS.greenPale,
            height: 22
        });
        y = drawTotalsRow(pdf, PAGE.margin, y, 'Sub Total', totalPaid, {
            labelWidth: TABLE_WIDTH - 112,
            fill: COLORS.greenPale,
            height: 22
        });
        y = drawTotalsRow(pdf, PAGE.margin, y, 'Sisa Pembayaran', remaining, {
            labelWidth: TABLE_WIDTH - 112,
            fill: COLORS.greenPale,
            height: 22
        });
    }

    y += 18;
    const bankWidth = 330;
    const rightX = PAGE.margin + bankWidth + 12;
    const signWidth = TABLE_WIDTH - bankWidth - 12;
    const bankBottom = drawBankBox(pdf, issuer, PAGE.margin, y, bankWidth);
    const signBottom = drawSignatory(pdf, issuer, signatureBuffer, rightX, y + 2, signWidth);
    y = Math.max(bankBottom, signBottom) + 18;

    const notes = snapshot.notes ?? snapshot.payment_terms ?? [];
    if (notes) {
        y = drawNotes(pdf, notes, PAGE.margin, y, TABLE_WIDTH, PAGE.height - 62);
    }

    const pages = pdf.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
        pdf.switchToPage(index);
        const pageNumber = index + 1;
        pdf.moveTo(PAGE.margin, PAGE.height - 48)
            .lineTo(PAGE.width - PAGE.margin, PAGE.height - 48)
            .lineWidth(0.7)
            .stroke(COLORS.green);
        drawText(pdf, 'Dokumen diterbitkan oleh ' + issuer.display_name,
            PAGE.margin, PAGE.height - 39, 330, { size: 6.5, color: COLORS.muted });
        drawText(pdf, 'Nomor dokumen: ' + record.document_number + ' | Halaman ' + pageNumber,
            PAGE.width - PAGE.margin - 190, PAGE.height - 39, 190, {
                size: 6.5, color: COLORS.muted, align: 'right'
            });
    }

    pdf.end();
    return result;
}
