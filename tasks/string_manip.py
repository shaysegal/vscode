from collections import Counter
from itertools import repeat


text =  "Twas brillig and the slithy tove\nDid gyre and gimble in the wabe\nAll mimsy were the borogoves\nAnd the mome raths outgrabe\nBeware the Jabberwock my son\nThe jaws that bite the claws that catch\nBeware the Jubjub bird and shun\nThe frumious Bandersnatch"



"""
Goal is to keep the sentence the same length, replacing each word/punctuation by the number of times it appears in the paragraph
"""

def reformat(s: str, top_word: str, replacement: str, num_words: int) -> str:
    r = ??
    return r
# Solution
# s = " ".join(s.replace(top_word, replacement, num_words).split(" ")[0:num_words])


class RefromSentences:
    def __init__(self) -> None:
        self.word_count = Counter()
    
    # remove the rightmost most instance of the most popular word so far
    def modify_text(self, text: str) -> str:
        new_text = ""
        for s in text.split('\n'):
            num_words = len(s.split())
            self.word_count += Counter(word for word in s.split(' '))
            (top_word, word_count) = self.word_count.most_common()[0]

            s = reformat(s, top_word+' ', (top_word+' ')*word_count, num_words)
            # new_text += (". " + s)

        return new_text

# if __name__ == "__main__":
rs = RefromSentences()
new_text = rs.modify_text(text)

print(text)
print(new_text)
