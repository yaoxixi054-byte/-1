import os
import base64
import json
import re
from collections import Counter
import google.generativeai as genai

# 配置 Gemini API
# 请在环境变量中设置 GEMINI_API_KEY 或直接在这里替换
genai.configure(api_key=os.environ.get("GEMINI_API_KEY", "YOUR_API_KEY"))

# 停用词列表 (Stopwords List)
STOPWORDS = {
    "am", "is", "are", "was", "were", "be", "been",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
    "the", "a", "an", "and", "of", "in", "to", "with", "that"
}

def analyze_file(file_path):
    """使用 Gemini 1.5 Pro 提取文本并标注词性"""
    model = genai.GenerativeModel('gemini-1.5-pro')
    
    with open(file_path, "rb") as f:
        file_data = f.read()
        mime_type = "application/pdf" if file_path.endswith(".pdf") else "image/jpeg"
        
    prompt = """Extract all English words from this document. For each word, identify its part of speech (POS) based on the context (e.g., n., v., adj., adv.). 
    Return the result as a JSON array of objects: [{"word": "example", "pos": "n."}]. 
    Do not perform lemmatization. Only return the JSON array."""

    response = model.generate_content([
        prompt,
        {'mime_type': mime_type, 'data': file_data}
    ])
    
    try:
        # 提取 JSON 部分
        json_match = re.search(r'\[.*\]', response.text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
        return []
    except Exception as e:
        print(f"解析 {file_path} 时出错: {e}")
        return []

def process_results(all_results):
    """文本清洗与词频统计"""
    aggregated = {}
    
    for item in all_results:
        word = item['word'].lower()
        pos = item['pos']
        
        # 剔除干扰：标点、数字、单字母选项
        clean_word = re.sub(r'[^a-z]', '', word)
        
        if not clean_word:
            continue
        if len(clean_word) == 1 and clean_word in ['a', 'b', 'c', 'd']:
            continue
            
        # 停用词过滤
        if clean_word in STOPWORDS:
            continue
            
        if clean_word not in aggregated:
            aggregated[clean_word] = {'count': 0, 'pos_tags': Counter()}
            
        aggregated[clean_word]['count'] += 1
        aggregated[clean_word]['pos_tags'][pos] += 1
        
    # 格式化输出
    final_list = []
    for word, data in aggregated.items():
        # 取出现频率最高的词性
        most_common_pos = data['pos_tags'].most_common(1)[0][0]
        final_list.append({
            'Word': word,
            'POS Tag': most_common_pos,
            'Total Frequency': data['count']
        })
        
    # 按词频从高到低排序
    return sorted(final_list, key=lambda x: x['Total Frequency'], reverse=True)

def main(file_paths):
    all_extracted_data = []
    
    for path in file_paths:
        print(f"正在分析文件: {path}...")
        data = analyze_file(path)
        all_extracted_data.extend(data)
        
    final_results = process_results(all_extracted_data)
    
    # 输出结果
    print("\n" + "="*50)
    print(f"{'单词原貌 (Word)':<20} | {'标注词性 (POS)':<10} | {'最终总频次':<10}")
    print("-" * 50)
    for res in final_results:
        print(f"{res['Word']:<20} | {res['POS Tag']:<10} | {res['Total Frequency']:<10}")

if __name__ == "__main__":
    # 示例：替换为你的文件路径
    test_files = ["paper1.pdf", "paper2.jpg"] 
    # main(test_files)
    print("请在代码中配置 test_files 路径并确保设置了 GEMINI_API_KEY 环境变量。")
