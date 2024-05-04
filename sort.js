class Sort {
    constructor(object, key1, key2 = '') {
        this.key1 = key1;
        this.key2 = key2;
        const key1 = key1;
        if (key2 === '') {
            return object.sort(this.compareFn1);
        } else {
            return object.sort(this.compareFn2);
        }
    }
    compareFn1(a, b) {
        if (a[key1] < b[key1]) {
            return -1;
        } else if (a[key1] > b[key1]) {
            return 1;
        }
        return 0;
    }
    compareFn2() {
        
        console.log(this)
        key1 = this.key1;
        key2 = this.key2;
        if (a[key1][key2] < b[key1][key2]) {
            return -1;
        } else if (a[key1][key2] > b[key1][key2]) {
            return 1;
        }
        return 0;
    }
}

const object = [{'A': 1, 'B': 3}, {'A': 1, 'B': 2}, {'A': 1, 'B': 1}];
const key_1 = 'A';

console.log(new Sort(object, key_1))