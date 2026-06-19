import scrapy
import sys
import re
from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings

class TextSpider(scrapy.Spider):
    name = "text_spider"
    
    # Custom settings for scraping
    custom_settings = {
        'USER_AGENT': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'ROBOTSTXT_OBEY': False,
        'DOWNLOAD_TIMEOUT': 15,
        'LOG_LEVEL': 'DEBUG',
    }

    def __init__(self, url=None, output_file=None, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls = [url] if url else []
        self.output_file = output_file

    def parse(self, response):
        # Extract text content from body
        texts = response.xpath("//body//text()").getall()
        # Clean text
        cleaned_text = []
        for text in texts:
            cleaned = re.sub(r"\s+", " ", text).strip()
            if cleaned:
                cleaned_text.append(cleaned)
        
        full_text = "\n".join(cleaned_text)
        
        # Write to file
        if self.output_file:
            with open(self.output_file, "w", encoding="utf-8") as f:
                f.write(full_text)
        else:
            print(full_text)
            

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python scrapy_spider.py <url> <output_file>")
        sys.exit(1)
        
    url = sys.argv[1]
    output_file = sys.argv[2]
    
    process = CrawlerProcess(get_project_settings())
    process.crawl(TextSpider, url=url, output_file=output_file)
    process.start()
