# -*- coding: utf-8 -*-
"""
把 gen_table_cases.js 产出的 cases.json 逐组构建成**真实 .docx 文件**。

目的：让测试数据走与线上完全一致的数据链路
    .docx →(unzip)→ word/document.xml → extractDocxBlocks → splitScripts → 落库 → parseScript
唯一被替换的是微信 API `wx.getFileSystemManager().unzip()`（Node 端无对应实现），
其余全部为产品代码。

用法：python3 build_case_docx.py
产出：testcases/docx/C001.docx … ，并在 testcases/xml/C001.xml 留下解出的 document.xml
"""
import json
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CASES = os.path.join(HERE, 'testcases', 'cases.json')
DOCX_DIR = os.path.join(HERE, 'testcases', 'docx')
XML_DIR = os.path.join(HERE, 'testcases', 'xml')

CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

DOC_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'''


def esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def para_xml(text):
    """段落；单元格内的 \\n 渲染为 OOXML 软换行 <w:br/>"""
    parts = str(text).split('\n')
    runs = []
    for i, seg in enumerate(parts):
        if i > 0:
            runs.append('<w:r><w:br/></w:r>')
        if seg != '':
            runs.append('<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % esc(seg))
    return '<w:p>%s</w:p>' % ''.join(runs)


def cell_xml(text):
    return ('<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>%s</w:tc>'
            % para_xml(text))


def row_xml(cells):
    return '<w:tr>%s</w:tr>' % ''.join(cell_xml(c) for c in cells)


def table_xml(rows):
    return ('<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>%s</w:tbl>'
            % ''.join(row_xml(r) for r in rows))


def document_xml(tables, ep_start=1):
    body = []
    for i, t in enumerate(tables):
        body.append(para_xml('第%d集' % (ep_start + i)))
        body.append(para_xml('人物：测试人物　｜　场景：测试场景　｜　道具：测试道具'))
        body.append(table_xml(t['rows']))
        body.append(para_xml(''))
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body>%s<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
           % ''.join(body))
    return doc


def build(case, out_docx, out_xml):
    doc = document_xml(case['tables'], ep_start=1)
    with zipfile.ZipFile(out_docx, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CONTENT_TYPES)
        z.writestr('_rels/.rels', RELS)
        z.writestr('word/document.xml', doc)
        z.writestr('word/_rels/document.xml.rels', DOC_RELS)
    with open(out_xml, 'w', encoding='utf-8') as f:
        f.write(doc)


def main():
    os.makedirs(DOCX_DIR, exist_ok=True)
    os.makedirs(XML_DIR, exist_ok=True)
    data = json.load(open(CASES, encoding='utf-8'))
    n = 0
    for c in data['cases']:
        build(c,
              os.path.join(DOCX_DIR, c['id'] + '.docx'),
              os.path.join(XML_DIR, c['id'] + '.xml'))
        n += 1
    print('已生成 %d 个 .docx：%s' % (n, DOCX_DIR))
    # 抽样校验：解一个回来看看结构和真 docx 一致
    with zipfile.ZipFile(os.path.join(DOCX_DIR, data['cases'][0]['id'] + '.docx')) as z:
        names = z.namelist()
        xml = z.read('word/document.xml').decode('utf-8')
    print('包内文件：%s' % names)
    print('document.xml 长度：%d，含 <w:tbl> %d 个' % (len(xml), xml.count('<w:tbl>')))


if __name__ == '__main__':
    main()
