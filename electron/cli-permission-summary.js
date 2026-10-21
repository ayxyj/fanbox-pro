'use strict';

// File bodies belong in the terminal/editor, not in IM approval notifications.
function permissionSummary(tool, input = {}) {
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) return JSON.stringify(input, null, 2);
  const file = String(input.file_path || input.path || '未提供文件路径');
  const lines = [`文件：${file}`, `操作：${tool === 'Write' ? '写入文件（已有文件可能被覆盖）' : '修改文件'}`];
  const size = text => `${Buffer.byteLength(String(text || ''), 'utf8').toLocaleString('zh-CN')} 字节`;
  if (tool === 'Write') {
    lines.push(`写入大小：${size(input.content)}`);
  } else {
    const edits = tool === 'MultiEdit' && Array.isArray(input.edits) ? input.edits : [input];
    lines.push(`修改数量：${edits.length} 处`,
      `替换内容大小：${size(edits.map(edit => edit.new_string || '').join(''))}`);
    if (edits.some(edit => edit.replace_all)) lines.push('替换范围：包含全部匹配项替换');
  }
  lines.push('文件正文不在企微展示，可在终端或文件编辑器中查看。');
  return lines.join('\n');
}

module.exports = { permissionSummary };
