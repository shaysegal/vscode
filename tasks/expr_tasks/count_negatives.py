'''
given a list of l , return the number of negatives in it
for exmaple for l = [1,-1,2,-3,1], return 2
'''
def count_negatives(l:list)->int:
    raise NotImplementedError

print(count_negatives([1,-1,2,-3,1]))
print(count_negatives([1,1,2,3,1])) #should retrun 0
print(count_negatives([0,2,-3,1])) #should retrun 1